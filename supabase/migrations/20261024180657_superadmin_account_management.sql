-- Auth is the source of truth for administrator login details. A failed profile
-- write rolls back the Auth change too; passwords never enter public tables.
create function private.sync_admin_account_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.user_profiles set email = new.email
      where id = new.id and role = 'admin';
    if found then
      update public.staff_profiles set email = new.email where user_id = new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.sync_admin_account_email() from public, anon, authenticated;
create trigger sync_admin_account_email after update of email on auth.users
  for each row execute function private.sync_admin_account_email();
update public.user_profiles p set email = u.email from auth.users u
  where p.id = u.id and p.role = 'admin' and p.email is distinct from u.email;

-- Keep a team's name and other participants when its former trainer is removed.
alter table public.competition_teams alter column trainer_staff_id drop not null;
alter table public.competition_teams drop constraint competition_teams_trainer_staff_id_fkey;
alter table public.competition_teams add constraint competition_teams_trainer_staff_id_fkey
  foreign key (trainer_staff_id) references public.staff_profiles(id) on delete set null;

-- Signed evaluations remain immutable. Only a superadmin deleting the parent
-- staff profile may remove its own evaluations through ON DELETE CASCADE.
create or replace function private.protect_completed_training_evaluation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and auth.uid() is not null
    and private.current_user_role() = 'superadmin'
    and not exists (select 1 from public.staff_profiles where id = old.staff_id) then
    return old;
  end if;
  if old.status = 'completed' then
    if tg_op = 'UPDATE' and old.trainer_id is not null and new.trainer_id is null
      and (to_jsonb(old)-array['trainer_id','trainer_name_snapshot']) = (to_jsonb(new)-array['trainer_id','trainer_name_snapshot'])
      and not exists (select 1 from auth.users where id = old.trainer_id)
      and exists (select 1 from private.removing_account_names where user_id = old.trainer_id) then
      select coalesce(old.trainer_name_snapshot, display_name) into new.trainer_name_snapshot
        from private.removing_account_names where user_id = old.trainer_id;
      return new;
    end if;
    raise exception using errcode = '23514', message = case when tg_op = 'DELETE'
      then 'Una evaluación completada no se elimina; registra una corrección auditada'
      else 'Una evaluación completada y firmada es inmutable; registra una nueva evaluación' end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if old.trainer_id is not null and new.trainer_id is null then
    select coalesce(old.trainer_name_snapshot, display_name) into new.trainer_name_snapshot
      from private.removing_account_names where user_id = old.trainer_id;
  end if;
  return new;
end $$;
revoke all on function private.protect_completed_training_evaluation() from public, anon, authenticated;

create function private.superadmin_manage_staff_account(p_staff_id uuid, p_operation text, p_expected_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  staff public.staff_profiles%rowtype;
  account public.user_profiles%rowtype;
  entry_ids uuid[];
  evaluation_ids uuid[];
begin
  -- Revalidate live authorization inside the transaction, independently of Edge.
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.user_profiles where id = auth.uid() and role = 'superadmin' and status = 'active' for share;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_operation not in ('inspect_delete_staff', 'inspect_unlink_staff', 'delete_staff', 'unlink_staff') or p_operation is null then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  select * into staff from public.staff_profiles where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found' using errcode = 'P0002'; end if;
  if p_operation in ('delete_staff', 'unlink_staff') and staff.user_id is distinct from p_expected_user_id then
    raise exception 'account_link_conflict' using errcode = '23514';
  end if;
  if exists (select 1 from public.user_profiles where staff_profile_id = staff.id
    and id is distinct from staff.user_id) then
    raise exception 'account_link_conflict' using errcode = '23514';
  end if;
  if staff.user_id is not null then
    select * into account from public.user_profiles where id = staff.user_id for update;
    if not found then raise exception 'account_link_conflict' using errcode = '23514'; end if;
    if account.role in ('admin', 'superadmin') or account.id = auth.uid() then
      raise exception 'protected_account' using errcode = '42501';
    end if;
    if account.staff_profile_id is distinct from staff.id or account.store_id is distinct from staff.store_id then
      raise exception 'account_link_conflict' using errcode = '23514';
    end if;
    -- Storage objects must be removed through the Storage API, not SQL.
    if exists (
      select 1 from storage.objects o join public.training_evaluations e
        on o.bucket_id = 'training-signatures'
        and o.name in (e.collaborator_signature_path, e.trainer_signature_path)
      where o.owner_id = staff.user_id::text
        and (p_operation in ('inspect_unlink_staff', 'unlink_staff') or e.staff_id <> staff.id)
    ) then
      raise exception 'account_has_shared_files' using errcode = '23514';
    end if;
    if p_operation in ('delete_staff', 'unlink_staff') and exists (select 1 from storage.objects where owner_id = staff.user_id::text) then
      raise exception 'account_has_storage_objects' using errcode = '23514';
    end if;
  end if;

  if p_operation in ('inspect_delete_staff', 'inspect_unlink_staff') then
    return jsonb_build_object('userId', staff.user_id, 'files', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name))
      from storage.objects where owner_id = staff.user_id::text
    ), '[]'::jsonb));
  end if;

  if p_operation = 'delete_staff' then
    -- Remove only this participant's competition results, never their teammates'.
    select coalesce(array_agg(e.id), '{}'::uuid[]) into entry_ids
      from public.competition_entries e join public.competition_team_members m on m.id = e.member_id
      where m.staff_id = staff.id;
    select coalesce(array_agg(id), '{}'::uuid[]) into evaluation_ids
      from public.competition_evaluations where entry_id = any(entry_ids);
    delete from public.competition_timer_events where evaluation_id = any(evaluation_ids);
    delete from public.competition_evaluation_scores where evaluation_id = any(evaluation_ids);
    delete from public.competition_evaluations where id = any(evaluation_ids);
    delete from public.competition_entries where id = any(entry_ids);
    delete from public.competition_team_members where staff_id = staff.id;
    -- Existing FK cascades remove schedules, requests, holidays, skills, training,
    -- photos and legacy login approvals. Any failure rolls back the entire RPC.
    delete from public.staff_profiles where id = staff.id;
  else
    delete from private.approved_legacy_staff_logins where staff_id = staff.id;
    update public.staff_profiles set user_id = null, email = null, linked_at = null,
      status = case when status = 'active' then 'pending'::public.record_status else status end
      where id = staff.id;
  end if;
  if staff.user_id is not null then
    -- Same atomic Auth cleanup already used by cessation management, including
    -- session/identity cascades and snapshots of authorship on other staff records.
    delete from auth.users where id = staff.user_id;
  end if;
  return jsonb_build_object('deleted', p_operation = 'delete_staff', 'unlinked', p_operation = 'unlink_staff',
    'staffId', staff.id, 'deletedRecords', case when p_operation = 'delete_staff' then 1 else 0 end);
end $$;
revoke all on function private.superadmin_manage_staff_account(uuid, text, uuid) from public, anon;
grant execute on function private.superadmin_manage_staff_account(uuid, text, uuid) to authenticated;

create function public.superadmin_manage_staff_account(p_staff_id uuid, p_operation text, p_expected_user_id uuid default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.superadmin_manage_staff_account(p_staff_id, p_operation, p_expected_user_id)
$$;
revoke all on function public.superadmin_manage_staff_account(uuid, text, uuid) from public, anon;
grant execute on function public.superadmin_manage_staff_account(uuid, text, uuid) to authenticated;
