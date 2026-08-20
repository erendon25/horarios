-- Applied after Codex Security scan 0c01758b-d32e-4efe-8561-b95203cfbf15.
-- Preserves the existing privileged branches and closes the confirmed
-- final-role and user/staff/store binding gaps.

drop policy if exists user_profiles_admin_update on public.user_profiles;
create policy user_profiles_admin_update on public.user_profiles for update to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or (
      store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) = 'admin'
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (
      store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) = 'admin'
      and role <> 'superadmin'
    )
  );

drop policy if exists worked_holidays_write on public.worked_holidays;
create policy worked_holidays_write on public.worked_holidays for all to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = worked_holidays.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = worked_holidays.store_id
      )
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = worked_holidays.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = worked_holidays.store_id
      )
    )
  );

drop policy if exists extra_hours_write on public.extra_hours;
create policy extra_hours_write on public.extra_hours for all to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = extra_hours.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = extra_hours.store_id
      )
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = extra_hours.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = extra_hours.store_id
      )
    )
  );

drop policy if exists schedule_requests_create on public.schedule_requests;
create policy schedule_requests_create on public.schedule_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and admin_comment is null
    and exists (
      select 1 from public.staff_profiles sp
      where sp.id = schedule_requests.staff_id
        and sp.user_id = (select auth.uid())
        and sp.store_id = schedule_requests.store_id
    )
  );
