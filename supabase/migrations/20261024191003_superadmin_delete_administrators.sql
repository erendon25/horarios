-- Delete only an administrator's access account, preserving stores and work history.
create function private.superadmin_manage_admin_account(p_user_id uuid, p_operation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account public.user_profiles%rowtype;
  linked_staff public.staff_profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  perform 1 from public.user_profiles where id = auth.uid() and role = 'superadmin' and status = 'active' for share;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_operation not in ('inspect_delete_admin', 'delete_admin') or p_operation is null then
    raise exception 'invalid_operation' using errcode = '22023';
  end if;
  if p_user_id = auth.uid() then raise exception 'protected_account' using errcode = '42501'; end if;
  select * into account from public.user_profiles where id = p_user_id for update;
  if not found then raise exception 'admin_not_found' using errcode = 'P0002'; end if;
  if account.role <> 'admin' then raise exception 'protected_account' using errcode = '42501'; end if;
  select * into linked_staff from public.staff_profiles where user_id = account.id for update;
  if account.staff_profile_id is not null and account.staff_profile_id is distinct from linked_staff.id then
    raise exception 'account_link_conflict' using errcode = '23514';
  end if;
  -- All evaluations are preserved, including those signed by this administrator.
  if exists (
    select 1 from storage.objects o join public.training_evaluations e
      on o.bucket_id = 'training-signatures'
      and o.name in (e.collaborator_signature_path, e.trainer_signature_path)
    where o.owner_id = account.id::text
  ) then raise exception 'account_has_shared_files' using errcode = '23514'; end if;
  if p_operation = 'inspect_delete_admin' then
    return jsonb_build_object('userId', account.id, 'files', coalesce((
      select jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name))
      from storage.objects where owner_id = account.id::text
    ), '[]'::jsonb));
  end if;
  if exists (select 1 from storage.objects where owner_id = account.id::text) then
    raise exception 'account_has_storage_objects' using errcode = '23514';
  end if;
  if linked_staff.id is not null then
    update public.staff_profiles set user_id = null, email = null, linked_at = null,
      status = case when status = 'active' then 'pending'::public.record_status else status end
      where id = linked_staff.id;
  end if;
  -- Auth cascades remove the administrator profile, sessions and identities.
  -- Existing triggers preserve historical author names on other people's records.
  delete from auth.users where id = account.id;
  return jsonb_build_object('deleted', true, 'userId', account.id);
end $$;
revoke all on function private.superadmin_manage_admin_account(uuid, text) from public, anon;
grant execute on function private.superadmin_manage_admin_account(uuid, text) to authenticated;

create function public.superadmin_manage_admin_account(p_user_id uuid, p_operation text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.superadmin_manage_admin_account(p_user_id, p_operation)
$$;
revoke all on function public.superadmin_manage_admin_account(uuid, text) from public, anon;
grant execute on function public.superadmin_manage_admin_account(uuid, text) to authenticated;
notify pgrst, 'reload schema';
