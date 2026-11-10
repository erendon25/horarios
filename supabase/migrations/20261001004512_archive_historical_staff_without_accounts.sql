-- Immutable text records replace synthetic migration profiles.
create table public.staff_history_archives (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.stores(id),
 fingerprint text not null unique,
 display_name text not null,
 reason text not null,
 archived_at timestamptz not null default now(),
 staff_snapshot jsonb not null,
 records jsonb not null
);
alter table public.staff_history_archives enable row level security;
revoke all on public.staff_history_archives from public,anon,authenticated;
grant select on public.staff_history_archives to authenticated;
create policy staff_history_archives_admin_read on public.staff_history_archives for select to authenticated using (
 (select private.current_user_role())='superadmin'
 or ((select private.current_user_role())='admin' and store_id=(select private.current_user_store_id()))
);
create index staff_history_archives_store_date on public.staff_history_archives(store_id,archived_at desc);

create function private.strip_archive_identity(value jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(value)='object' then
   result:='{}';
   for k,v in select * from jsonb_each(value) loop
     if replace(k,'_','') !~* '^(uid|userid|staffid|staffprofileid|collaboratorid|trainerid|actorid|ownerid|reviewedby|publishedby|createdby|updatedby|firebaseuid|firestoreid|sourceidentifier|sourcekey)$' then
       result:=result||jsonb_build_object(k,private.strip_archive_identity(v));
     end if;
   end loop;
   return result;
 elsif jsonb_typeof(value)='array' then
   select coalesce(jsonb_agg(private.strip_archive_identity(x)),'[]') into result from jsonb_array_elements(value) x;
   return result;
 end if;
 return value;
end $$;
revoke all on function private.strip_archive_identity(jsonb) from public,anon,authenticated;

create function private.archive_synthetic_staff(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.staff_profiles%rowtype; rec jsonb:='{}'; tbl text; data jsonb; archive_id uuid;
begin
 select * into s from public.staff_profiles where id=p_id for update;
 if not found then return null; end if;
 if s.status<>'inactive' or not (s.first_name like 'Histórico %' or s.first_name ilike 'historico %') then raise exception 'Solo perfiles sintéticos inactivos'; end if;
 if exists(select 1 from public.competition_team_members where staff_id=s.id)
 or exists(select 1 from public.competition_teams where trainer_staff_id=s.id)
 or exists(select 1 from public.training_evaluations where staff_id=s.id) then raise exception 'El perfil contiene evaluaciones o concursos: requiere revisión'; end if;
 foreach tbl in array array['schedule_weeks','extra_hours','worked_holidays','schedule_requests','study_schedule_days','staff_skills','cessations','suggestive_sales_goal_assignments'] loop
   execute format('select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(t))),''[]''::jsonb) from public.%I t where staff_id=$1',tbl) into data using s.id;
   rec:=rec||jsonb_build_object(tbl,data);
 end loop;
 select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(sh))),'[]') into data from public.schedule_shifts sh join public.schedule_weeks w on w.id=sh.schedule_week_id where w.staff_id=s.id;
 rec:=rec||jsonb_build_object('schedule_shifts',data);
 select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(b))),'[]') into data from public.study_schedule_blocks b join public.study_schedule_days d on d.id=b.study_day_id where d.staff_id=s.id;
 rec:=rec||jsonb_build_object('study_schedule_blocks',data);
 insert into public.staff_history_archives(store_id,fingerprint,display_name,reason,staff_snapshot,records)
 values(s.store_id,md5(s.id::text),trim(concat_ws(' ',s.first_name,s.last_name)),'historical_import',
 jsonb_build_object('name',s.first_name,'lastName',s.last_name,'modality',s.modality,'position',s.position,'joinDate',s.join_date,'cessationDate',s.cessation_date),rec)
 returning id into archive_id;
 -- These rows are history, not operational staff. Unlink access before removal.
 if s.user_id is not null then
   if not exists(select 1 from public.user_profiles u where u.id=s.user_id and u.staff_profile_id=s.id and u.role in('collaborator','trainer')) then raise exception 'Cuenta vinculada inconsistente o administrativa'; end if;
   delete from auth.users where id=s.user_id;
 end if;
 delete from public.staff_profiles where id=s.id;
 return archive_id;
end $$;
revoke all on function private.archive_synthetic_staff(uuid) from public,anon,authenticated;

-- Preserve author names when an access account is removed, without keeping its FK.
create table private.removing_account_names(user_id uuid primary key,display_name text not null);
revoke all on private.removing_account_names from public,anon,authenticated;
alter table private.removing_account_names enable row level security;
alter table public.training_evaluations add column trainer_name_snapshot text;
create or replace function private.protect_completed_training_evaluation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.status='completed' then
   if tg_op='UPDATE' and old.trainer_id is not null and new.trainer_id is null
      and (to_jsonb(old)-array['trainer_id','trainer_name_snapshot'])=(to_jsonb(new)-array['trainer_id','trainer_name_snapshot'])
      and not exists(select 1 from auth.users where id=old.trainer_id)
      and exists(select 1 from private.removing_account_names where user_id=old.trainer_id) then
     select coalesce(old.trainer_name_snapshot,display_name) into new.trainer_name_snapshot from private.removing_account_names where user_id=old.trainer_id;
     return new;
   end if;
   raise exception using errcode='23514',message=case when tg_op='DELETE' then 'Una evaluación completada no se elimina; registra una corrección auditada' else 'Una evaluación completada y firmada es inmutable; registra una nueva evaluación' end;
 end if;
 if tg_op='DELETE' then return old; end if;
 if old.trainer_id is not null and new.trainer_id is null then
   select coalesce(old.trainer_name_snapshot,display_name) into new.trainer_name_snapshot from private.removing_account_names where user_id=old.trainer_id;
 end if;
 return new;
end $$;

alter table public.competitions add column creator_name_snapshot text;
alter table public.competitions alter column created_by drop not null;
alter table public.competitions drop constraint competitions_created_by_fkey;
alter table public.competitions add constraint competitions_created_by_fkey foreign key(created_by) references auth.users(id) on delete set null;
alter table public.competition_evaluations add column starter_name_snapshot text;
alter table public.competition_evaluations add column evaluator_name_snapshot text;
alter table public.competition_evaluations alter column evaluated_by drop not null;
alter table public.competition_evaluations drop constraint competition_evaluations_started_by_fkey;
alter table public.competition_evaluations drop constraint competition_evaluations_evaluated_by_fkey;
alter table public.competition_evaluations add constraint competition_evaluations_started_by_fkey foreign key(started_by) references auth.users(id) on delete set null;
alter table public.competition_evaluations add constraint competition_evaluations_evaluated_by_fkey foreign key(evaluated_by) references auth.users(id) on delete set null;
alter table public.competition_timer_events add column performer_name_snapshot text;
alter table public.competition_timer_events alter column performed_by drop not null;
alter table public.competition_timer_events drop constraint competition_timer_events_performed_by_fkey;
alter table public.competition_timer_events add constraint competition_timer_events_performed_by_fkey foreign key(performed_by) references auth.users(id) on delete set null;

create function private.snapshot_account_before_delete() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;
begin
 select nullif(trim(concat_ws(' ',first_name,last_name)),'') into label from public.user_profiles where id=old.id;
 label:=coalesce(label,'Cuenta eliminada');
 insert into private.removing_account_names values(old.id,label) on conflict(user_id) do update set display_name=excluded.display_name;
 update public.competitions set creator_name_snapshot=label where created_by=old.id;
 update public.competition_evaluations set starter_name_snapshot=label where started_by=old.id;
 update public.competition_evaluations set evaluator_name_snapshot=label where evaluated_by=old.id;
 update public.competition_timer_events set performer_name_snapshot=label where performed_by=old.id;
 return old;
end $$;
revoke all on function private.snapshot_account_before_delete() from public,anon,authenticated;
create trigger snapshot_account_before_delete before delete on auth.users for each row execute function private.snapshot_account_before_delete();
-- Statement-level cleanup runs after all FK actions.
create function private.clear_account_delete_names() returns trigger language plpgsql security definer set search_path='' as $$
begin delete from private.removing_account_names; return null; end $$;
revoke all on function private.clear_account_delete_names() from public,anon,authenticated;
create trigger clear_account_delete_names after delete on auth.users for each statement execute function private.clear_account_delete_names();

create function private.remove_ended_access_accounts(p_store uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare s record; n integer:=0;
begin
 for s in select sp.id,sp.user_id from public.staff_profiles sp join public.user_profiles u on u.id=sp.user_id and u.staff_profile_id=sp.id
 where (p_store is null or sp.store_id=p_store) and sp.cessation_date<(clock_timestamp() at time zone 'America/Lima')::date
 and u.role in('collaborator','trainer') for update of sp,u loop
   update public.staff_profiles set status='inactive' where id=s.id;
   delete from auth.users where id=s.user_id;
   n:=n+1;
 end loop;
 for s in select u.id as user_id from public.user_profiles u
 where u.status='inactive' and u.staff_profile_id is null and u.role in('collaborator','trainer')
 and (p_store is null or u.store_id=p_store)
 and not exists(select 1 from public.staff_profiles where user_id=u.id) for update of u loop
   delete from auth.users where id=s.user_id;
   n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function private.remove_ended_access_accounts(uuid) from public,anon,authenticated;
create function public.cleanup_ended_staff_accounts(p_store_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(private.current_user_role()='superadmin' or (private.current_user_role()='admin' and p_store_id=private.current_user_store_id()),false) then raise exception 'Tienda no autorizada' using errcode='42501'; end if;
 return private.remove_ended_access_accounts(p_store_id);
end $$;
revoke all on function public.cleanup_ended_staff_accounts(uuid) from public,anon;
grant execute on function public.cleanup_ended_staff_accounts(uuid) to authenticated;

-- Migrate only the explicitly synthetic placeholders; named recovered staff stay intact.
do $$ declare s record; begin
 for s in select id from public.staff_profiles where status='inactive' and (first_name like 'Histórico %' or first_name ilike 'historico %') loop
   perform private.archive_synthetic_staff(s.id);
 end loop;
end $$;
-- Current ceased accounts of the managed store, inclusive last day remains valid.
select private.remove_ended_access_accounts('50294ced-5b38-5b06-a54e-515d6c94a513');

-- An already effective cessation removes access in the same transaction.
create function private.cleanup_access_on_cessation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.cessation_date<(clock_timestamp() at time zone 'America/Lima')::date then
   perform private.remove_ended_access_accounts(new.store_id);
 end if;
 return new;
end $$;
revoke all on function private.cleanup_access_on_cessation() from public,anon,authenticated;
create trigger staff_profiles_cleanup_access_on_cessation after insert or update of cessation_date
on public.staff_profiles for each row execute function private.cleanup_access_on_cessation();
