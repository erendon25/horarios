-- Expose only the minimum data required to build the daily positioning PDF.
-- The privileged reader lives outside the exposed API schema and derives the
-- store from the authenticated account, so callers cannot request another store.
create or replace function private.schedule_pdf_context(p_week_start date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
  v_store_id uuid;
  v_profile_staff_id uuid;
  v_staff_id uuid;
  v_position text;
  v_staff jsonb;
  v_schedules jsonb;
  v_positions jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  select
    profile.role,
    profile.store_id,
    profile.staff_profile_id,
    staff.id,
    upper(trim(coalesce(staff.position, '')))
  into
    v_role,
    v_store_id,
    v_profile_staff_id,
    v_staff_id,
    v_position
  from public.user_profiles profile
  join public.stores store
    on store.id = profile.store_id
   and store.is_active
  left join public.staff_profiles staff
    on staff.id = profile.staff_profile_id
   and staff.user_id = profile.id
   and staff.store_id = profile.store_id
   and staff.status in ('active', 'pending')
   and (
     staff.cessation_date is null
     or staff.cessation_date >= (now() at time zone 'America/Lima')::date
   )
   and (
     not staff.is_trainee
     or staff.training_end_date is null
     or staff.training_end_date >= (now() at time zone 'America/Lima')::date
   )
  where profile.id = (select auth.uid())
    and profile.status = 'active'
    and not profile.registration_pending
  limit 1;

  if v_role is null
    or v_store_id is null
    or (v_profile_staff_id is not null and v_staff_id is null)
  then
    raise exception 'Schedule PDF access denied'
      using errcode = '42501';
  end if;

  if v_staff_id is null
    or v_position not in ('ENTRENADOR', 'ASISTENTE', 'GERENTE')
  then
    raise exception 'Schedule PDF access denied'
      using errcode = '42501';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'The schedule week must start on Monday'
      using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', staff.id::text,
        'name', staff.first_name,
        'modality', staff.modality
      )
      order by staff.first_name, staff.last_name, staff.id
    ),
    '[]'::jsonb
  )
  into v_staff
  from public.staff_profiles staff
  where staff.store_id = v_store_id
    and exists (
      select 1
      from public.schedule_weeks schedule_week
      where schedule_week.staff_id = staff.id
        and schedule_week.store_id = v_store_id
        and schedule_week.week_start = p_week_start
    );

  select coalesce(
    jsonb_object_agg(
      schedule_week.staff_id::text,
      coalesce(schedule_week.legacy_data, '{}'::jsonb)
        || jsonb_build_object(
          'staffId', schedule_week.staff_id::text,
          'storeId', schedule_week.store_id::text,
          'weekKey', to_char(schedule_week.week_start, 'YYYY-MM-DD')
            || '_to_'
            || to_char(schedule_week.week_start + 6, 'YYYY-MM-DD')
        )
        || coalesce(day_data.days, '{}'::jsonb)
    ),
    '{}'::jsonb
  )
  into v_schedules
  from public.schedule_weeks schedule_week
  left join lateral (
    select jsonb_object_agg(
      case extract(isodow from shift.work_date)::integer
        when 1 then 'monday'
        when 2 then 'tuesday'
        when 3 then 'wednesday'
        when 4 then 'thursday'
        when 5 then 'friday'
        when 6 then 'saturday'
        when 7 then 'sunday'
      end,
      coalesce(shift.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'start', coalesce(to_char(shift.start_time, 'HH24:MI'), shift.metadata->>'start', ''),
          'end', coalesce(to_char(shift.end_time, 'HH24:MI'), shift.metadata->>'end', ''),
          'position', coalesce(shift.position, shift.metadata->>'position', ''),
          'off', shift.is_day_off,
          'feriado', shift.is_holiday,
          'holiday', shift.is_holiday,
          'notes', coalesce(shift.notes, shift.metadata->>'notes', '')
        )
    ) as days
    from public.schedule_shifts shift
    where shift.schedule_week_id = schedule_week.id
  ) day_data on true
  where schedule_week.store_id = v_store_id
    and schedule_week.week_start = p_week_start;

  select coalesce(requirement.requirements->'positions', '[]'::jsonb)
    into v_positions
  from public.store_positioning_requirements requirement
  where requirement.store_id = v_store_id
    and requirement.requirement_key = 'monday'
  limit 1;

  return jsonb_build_object(
    'staff', v_staff,
    'schedules', v_schedules,
    'positions', coalesce(v_positions, '[]'::jsonb)
  );
end;
$$;

revoke all on function private.schedule_pdf_context(date) from public, anon, authenticated;
grant execute on function private.schedule_pdf_context(date) to authenticated;

-- PostgREST exposes this invoker wrapper; the privileged implementation above
-- remains in the non-exposed private schema and performs the authorization.
create or replace function public.get_schedule_pdf_context(p_week_start date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.schedule_pdf_context(p_week_start)
$$;

revoke all on function public.get_schedule_pdf_context(date) from public, anon;
grant execute on function public.get_schedule_pdf_context(date) to authenticated;

comment on function public.get_schedule_pdf_context(date) is
  'Returns the minimum store schedule data needed for PDF export after role/position authorization.';
