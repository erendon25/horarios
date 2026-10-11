-- Competition recognition is separate from signed training results and manual skills.
alter table public.staff_profiles add column competition_recognition jsonb not null
  default '{"certifications":{},"championships":[]}'::jsonb;

create function private.competition_training_station(p_area text) returns text
language sql immutable set search_path='' as $$
 select case lower(trim(p_area))
   when 'landing' then 'LANDING' when 'landing crazy' then 'LANDING'
   when 'vestido' then 'VESTIDO' when 'sheetout' then 'SHEETOUT'
   when 'masa' then 'PREPARACION' when 'drive thru' then 'TRAFICO'
   when 'servicio' then 'SERVICIO' end
$$;

create function private.staff_competition_recognition(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with entries as (
   select en.id,en.status,en.competition_id,a.id area_id,a.name area_name,
     private.competition_training_station(a.name) station
   from public.competition_entries en
   join public.competition_team_members m on m.id=en.member_id
   join public.competition_areas a on a.id=en.area_id
   where m.staff_id=p_staff_id
 ), certified as (
   select distinct x.station from entries x
   where x.station is not null and exists (
     select 1 from public.competition_evaluations ev where ev.entry_id=x.id
       and ev.timer_status='saved' and ev.approved and not ev.is_tiebreaker
   )
 )
 select jsonb_build_object(
   'certifications',coalesce((select jsonb_object_agg(station,100) from certified),'{}'::jsonb),
   'championships',coalesce((select jsonb_agg(jsonb_build_object(
       'competition_id',competition_id,'area_id',area_id,'area_name',area_name)
       order by competition_id,area_id) from entries where status='champion'),'[]'::jsonb)
 )
$$;

-- Even a caller with staff write permissions cannot invent these recognitions.
create function private.guard_staff_competition_recognition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.competition_recognition:=private.staff_competition_recognition(new.id);
 return new;
end $$;
create trigger staff_competition_recognition_guard before insert or update of competition_recognition
on public.staff_profiles for each row execute function private.guard_staff_competition_recognition();

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_recognition;
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_store uuid; v_role public.app_role:=private.current_user_role();
begin
 if p_action in ('finalize','correct','champion','area') then
   if auth.uid() is null or v_role is null or v_role not in ('admin','superadmin') then
     raise exception 'Solo administradores activos pueden gestionar concursos' using errcode='42501';
   end if;
   select store_id into v_store from public.competitions where id=p_competition_id
     and (v_role='superadmin' or store_id=private.current_user_store_id()) for update;
   if v_store is null then raise exception 'Tienda no autorizada' using errcode='42501'; end if;
   -- Serialize updates for overlapping participants across contests, in UUID order.
   perform s.id from public.staff_profiles s where exists (
     select 1 from public.competition_team_members m where m.staff_id=s.id and m.competition_id=p_competition_id
   ) order by s.id for update;
 end if;
 v_result:=private.competition_command_before_recognition(p_competition_id,p_action,p_payload);
 if p_action in ('finalize','correct','champion','area') then
   update public.staff_profiles s set competition_recognition=private.staff_competition_recognition(s.id)
   where exists (select 1 from public.competition_team_members m
     where m.staff_id=s.id and m.competition_id=p_competition_id)
     and s.competition_recognition is distinct from private.staff_competition_recognition(s.id);
 end if;
 return v_result;
end $$;

revoke all on function private.competition_training_station(text),
 private.staff_competition_recognition(uuid),private.guard_staff_competition_recognition(),
 private.competition_command_before_recognition(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;

-- Backfill existing official advances and winners, including completed contests.
update public.staff_profiles s set competition_recognition=private.staff_competition_recognition(s.id)
where exists(select 1 from public.competition_team_members m where m.staff_id=s.id);
comment on column public.staff_profiles.competition_recognition is
 'Server-derived station certifications at 100 and area championships; independent of training evaluations.';
notify pgrst,'reload schema';
