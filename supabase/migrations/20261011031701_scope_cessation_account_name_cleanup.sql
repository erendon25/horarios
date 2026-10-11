-- Keep author-name snapshots through FK actions, then remove only the names
-- belonging to accounts deleted by this statement. An unqualified DELETE is
-- rejected by safeupdate in API sessions and rolls back effective cessations.
create or replace function private.clear_account_delete_names()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.removing_account_names names
  using deleted_accounts deleted
  where names.user_id = deleted.id;
  return null;
end;
$$;

revoke all on function private.clear_account_delete_names()
from public, anon, authenticated;

drop trigger if exists clear_account_delete_names on auth.users;
create trigger clear_account_delete_names
after delete on auth.users
referencing old table as deleted_accounts
for each statement execute function private.clear_account_delete_names();
