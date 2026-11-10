-- The dashboard creates and merges staff records with INSERT ... ON CONFLICT UPDATE.
-- Both privileges and both RLS policies are required for that operation.
grant insert, update on public.staff_profiles to authenticated;

create policy staff_profiles_admin_insert on public.staff_profiles
for insert to authenticated
with check (
  (select private.current_user_role()) = 'superadmin'
  or (
    (select private.current_user_role()) = 'admin'
    and store_id = (select private.current_user_store_id())
  )
);

create policy staff_profiles_admin_update on public.staff_profiles
for update to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (
    (select private.current_user_role()) = 'admin'
    and store_id = (select private.current_user_store_id())
  )
)
with check (
  (select private.current_user_role()) = 'superadmin'
  or (
    (select private.current_user_role()) = 'admin'
    and store_id = (select private.current_user_store_id())
  )
);
