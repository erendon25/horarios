-- All staff removal goes through the authorized, transactional account API.
-- An existing broad RLS policy must not allow bypassing its archive/protections.
revoke delete on public.staff_profiles from public, anon, authenticated;

create function private.archive_staff_before_removal(p_staff_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  staff public.staff_profiles%rowtype;
  records jsonb := '{}'::jsonb;
  table_name text;
  data jsonb;
  archive_id uuid;
begin
  select * into staff from public.staff_profiles where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found' using errcode = 'P0002'; end if;
  foreach table_name in array array[
    'schedule_weeks', 'extra_hours', 'worked_holidays', 'schedule_requests',
    'study_schedule_days', 'staff_skills', 'cessations',
    'suggestive_sales_goal_assignments', 'training_evaluations'
  ] loop
    execute format(
      'select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(t))), ''[]''::jsonb) from public.%I t where staff_id = $1',
      table_name
    ) into data using staff.id;
    records := records || jsonb_build_object(table_name, data);
  end loop;
  select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(shift))), '[]'::jsonb)
    into data from public.schedule_shifts shift
    join public.schedule_weeks week on week.id = shift.schedule_week_id
    where week.staff_id = staff.id;
  records := records || jsonb_build_object('schedule_shifts', data);
  select coalesce(jsonb_agg(private.strip_archive_identity(to_jsonb(block))), '[]'::jsonb)
    into data from public.study_schedule_blocks block
    join public.study_schedule_days day on day.id = block.study_day_id
    where day.staff_id = staff.id;
  records := records || jsonb_build_object('study_schedule_blocks', data);
  insert into public.staff_history_archives(
    store_id, fingerprint, display_name, reason, staff_snapshot, records
  ) values (
    staff.store_id, md5(staff.id::text), trim(concat_ws(' ', staff.first_name, staff.last_name)), 'staff_deleted',
    jsonb_build_object('name', staff.first_name, 'lastName', staff.last_name,
      'modality', staff.modality, 'position', staff.position,
      'joinDate', staff.join_date, 'cessationDate', staff.cessation_date), records
  ) returning id into archive_id;
  return archive_id;
end $$;
revoke all on function private.archive_staff_before_removal(uuid) from public, anon, authenticated;

-- Signed evaluations remain immutable except for the parent staff deletion
-- already authorized and archived by the staff-account transaction. The store
-- predicate also applies inside FK cascades, independently of the Edge handler.
create or replace function private.protect_completed_training_evaluation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and auth.uid() is not null
    and not exists (select 1 from public.staff_profiles where id = old.staff_id)
    and exists (
      select 1 from public.staff_history_archives archive
      where archive.fingerprint = md5(old.staff_id::text) and archive.reason = 'staff_deleted'
        and (private.current_user_role() = 'superadmin'
          or (private.current_user_role() = 'admin'
            and archive.store_id = private.current_user_store_id()))
    ) then
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

create or replace function private.superadmin_manage_staff_account(p_staff_id uuid, p_operation text, p_expected_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller public.user_profiles%rowtype;
  staff public.staff_profiles%rowtype;
  account public.user_profiles%rowtype;
  entry_ids uuid[];
  evaluation_ids uuid[];
begin
  -- Revalidate live authorization inside the transaction, independently of Edge.
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into caller from public.user_profiles
    where id = auth.uid() and role in ('superadmin', 'admin') and status = 'active' for share;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_operation not in ('inspect_delete_staff', 'inspect_unlink_staff', 'delete_staff', 'unlink_staff') or p_operation is null then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  -- The historical RPC name is retained for browser compatibility. Only staff
  -- deletion is delegated to store admins; unlinking remains superadmin-only.
  if caller.role = 'admin' then
    if caller.store_id is null or p_operation not in ('inspect_delete_staff', 'delete_staff') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    perform 1 from public.stores where id = caller.store_id and is_active for share;
    if not found then raise exception 'inactive_store' using errcode = '42501'; end if;
  end if;
  select * into staff from public.staff_profiles where id = p_staff_id for update;
  if not found then raise exception 'staff_not_found' using errcode = 'P0002'; end if;
  if caller.role = 'admin' and staff.store_id is distinct from caller.store_id then
    raise exception 'forbidden' using errcode = '42501';
  end if;
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
    -- Keep schedules/history as text records, without a surviving staff/Auth link.
    -- This insert and all following cascades roll back together on any failure.
    perform private.archive_staff_before_removal(staff.id);
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
    -- The active-account constraint forbids an active profile without staff.
    -- Deactivate within this same transaction before the FK clears its link;
    -- Auth deletion follows below, and failures roll back the status as well.
    update public.user_profiles set status = 'inactive' where id = staff.user_id;
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
