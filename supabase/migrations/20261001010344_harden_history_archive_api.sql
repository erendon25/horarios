alter function public.cleanup_ended_staff_accounts(uuid) set schema private;
revoke all on function private.cleanup_ended_staff_accounts(uuid) from public,anon;
grant execute on function private.cleanup_ended_staff_accounts(uuid) to authenticated;
create function public.cleanup_ended_staff_accounts(p_store_id uuid) returns integer
language sql security invoker set search_path='' as $$select private.cleanup_ended_staff_accounts(p_store_id)$$;
revoke all on function public.cleanup_ended_staff_accounts(uuid) from public,anon;
grant execute on function public.cleanup_ended_staff_accounts(uuid) to authenticated;
create policy removing_account_names_deny_client_access on private.removing_account_names
for all to authenticated using(false) with check(false);
