-- A trainer's raw Auth id is not enough to read evaluations: every staff role
-- must pass the canonical active-link helpers. Administrative reads remain
-- store-scoped, with superadmin as the explicit global exception.
drop policy if exists training_evaluations_read on public.training_evaluations;
create policy training_evaluations_read
on public.training_evaluations
for select
to authenticated
using (
  staff_id = (select private.current_staff_profile_id())
  or (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

-- Historical HR rows carry both staff_id and store_id. Until a dedicated
-- transfer workflow defines how that history should move, reject generic store
-- changes instead of leaving children readable by the old store and hidden
-- from the new one.
create or replace function private.prevent_staff_store_drift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.store_id is distinct from old.store_id then
    raise exception using
      errcode = '23514',
      message = 'El traslado de tienda requiere un flujo transaccional dedicado';
  end if;
  return new;
end;
$function$;

revoke all on function private.prevent_staff_store_drift()
  from public, anon, authenticated;

drop trigger if exists staff_profiles_prevent_store_drift on public.staff_profiles;
create trigger staff_profiles_prevent_store_drift
before update of store_id on public.staff_profiles
for each row execute function private.prevent_staff_store_drift();
