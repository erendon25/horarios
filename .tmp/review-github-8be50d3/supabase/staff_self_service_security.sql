-- Autogestión del colaborador: horas extra manuales y reclamos de feriado ganado.
-- Los registros importados de GeoVictoria solo pueden ser modificados por administración.

drop policy if exists extra_hours_write on public.extra_hours;
drop policy if exists extra_hours_admin_insert on public.extra_hours;
drop policy if exists extra_hours_admin_update on public.extra_hours;
drop policy if exists extra_hours_admin_delete on public.extra_hours;
drop policy if exists extra_hours_staff_insert on public.extra_hours;
drop policy if exists extra_hours_staff_delete_manual on public.extra_hours;
drop policy if exists extra_hours_insert on public.extra_hours;
drop policy if exists extra_hours_delete on public.extra_hours;

create policy extra_hours_insert on public.extra_hours for insert to authenticated
with check (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
  or (
    (select private.current_user_role()) = 'collaborator'
    and user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and source = 'manual'
    and source_file is null
    and imported_at is null
    and jsonb_array_length(segments) = 0
    and jsonb_array_length(daily_details) = 0
    and exists (
      select 1 from public.staff_profiles sp
      where sp.id = extra_hours.staff_id
        and sp.user_id = (select auth.uid())
        and sp.store_id = extra_hours.store_id
    )
  )
);
create policy extra_hours_admin_update on public.extra_hours for update to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
)
with check (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
);
create policy extra_hours_delete on public.extra_hours for delete to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
  or (
    (select private.current_user_role()) = 'collaborator'
    and user_id = (select auth.uid())
    and source = 'manual'
    and exists (
      select 1 from public.staff_profiles sp
      where sp.id = extra_hours.staff_id
        and sp.user_id = (select auth.uid())
        and sp.store_id = extra_hours.store_id
    )
  )
);

grant select, insert, update, delete on public.extra_hours to authenticated;
grant usage, select on sequence public.extra_hours_id_seq to authenticated;

-- La relación con staff_profiles permite visualizar importaciones históricas cuyo user_id era nulo.
drop policy if exists extra_hours_read on public.extra_hours;
create policy extra_hours_read on public.extra_hours for select to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
  or exists (
    select 1 from public.staff_profiles sp
    where sp.id = extra_hours.staff_id
      and sp.user_id = (select auth.uid())
      and sp.store_id = extra_hours.store_id
  )
);

drop policy if exists worked_holidays_staff_insert on public.worked_holidays;
create policy worked_holidays_staff_insert on public.worked_holidays for insert to authenticated
with check (
  (select private.current_user_role()) = 'collaborator'
  and user_id = (select auth.uid())
  and store_id = (select private.current_user_store_id())
  and balance_type = 'ganado'
  and holiday_date <= current_date
  and exists (
    select 1 from public.staff_profiles sp
    where sp.id = worked_holidays.staff_id
      and sp.user_id = (select auth.uid())
      and sp.store_id = worked_holidays.store_id
  )
);
grant select, insert on public.worked_holidays to authenticated;

drop policy if exists worked_holidays_read on public.worked_holidays;
create policy worked_holidays_read on public.worked_holidays for select to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
  or exists (
    select 1 from public.staff_profiles sp
    where sp.id = worked_holidays.staff_id
      and sp.user_id = (select auth.uid())
      and sp.store_id = worked_holidays.store_id
  )
);
