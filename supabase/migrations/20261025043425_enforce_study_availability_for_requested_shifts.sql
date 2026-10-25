-- Study availability applies to newly requested/changed work intervals. Existing
-- schedules are not rewritten when an employee later changes their study hours.
-- These helpers use the caller's RLS visibility; no new privileged bypass exists.
create function private.study_extra_minutes(p_value text)
returns integer language plpgsql immutable security invoker set search_path = '' as $$
declare value text := replace(trim(coalesce(p_value, '')), ',', '.');
begin
  if value !~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$' then return 0; end if;
  return round(greatest(value::numeric, 0) * 60)::integer;
end $$;
revoke all on function private.study_extra_minutes(text) from public, anon;
grant execute on function private.study_extra_minutes(text) to authenticated;

create function private.assert_shift_study_availability(
  p_staff_id uuid, p_work_date date, p_start time, p_end time,
  p_extra_pre integer default 0, p_extra_post integer default 0
)
returns void language plpgsql stable security invoker set search_path = '' as $$
declare
  work_start timestamp;
  work_end timestamp;
  study_date date;
  day public.study_schedule_days%rowtype;
  block public.study_schedule_blocks%rowtype;
  study_start timestamp;
  study_end timestamp;
begin
  if p_work_date is null or p_start is null or p_end is null or p_start = p_end then
    raise exception 'Completa un rango válido de inicio y fin del turno' using errcode = '23514';
  end if;
  work_start := p_work_date + p_start - make_interval(mins => greatest(coalesce(p_extra_pre, 0), 0));
  work_end := p_work_date + p_end
    + case when p_end < p_start then interval '1 day' else interval '0 day' end
    + make_interval(mins => greatest(coalesce(p_extra_post, 0), 0));
  -- Include yesterday's study classes, which can continue past midnight. Study
  -- availability repeats every seven days, so one full cycle plus the repeated
  -- first day covers even very large extra-hour values without unbounded scans.
  for study_date in select date_value::date from generate_series(
    work_start::date - 1, least(work_end::date, work_start::date + 7), interval '1 day'
  ) date_value loop
    select * into day from public.study_schedule_days
      where staff_id = p_staff_id and weekday = extract(isodow from study_date)::integer - 1;
    if not found then continue; end if; -- Legacy missing days remain unrestricted.
    if day.requests_day_off then
      -- A requested day off is wholly unavailable; stale blocks are irrelevant.
      if work_start < study_date + interval '1 day' and work_end > study_date::timestamp then
        raise exception 'El turno coincide con un día libre solicitado en la disponibilidad de estudio' using errcode = '23514';
      end if;
      continue;
    end if;
    for block in select * from public.study_schedule_blocks where study_day_id = day.id loop
      study_start := study_date + block.start_time;
      study_end := study_date + block.end_time
        + case when block.end_time < block.start_time then interval '1 day' else interval '0 day' end;
      -- Half-open intervals: leaving exactly when class starts (or arriving when
      -- it ends) is allowed. A work break does not remove occupied work time.
      if work_start < study_end and work_end > study_start then
        raise exception 'El turno se cruza con el horario de estudio registrado' using errcode = '23514';
      end if;
    end loop;
  end loop;
end $$;
revoke all on function private.assert_shift_study_availability(uuid, date, time, time, integer, integer) from public, anon;
grant execute on function private.assert_shift_study_availability(uuid, date, time, time, integer, integer) to authenticated;

create function private.enforce_request_study_availability()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null and not exists (
    select 1 from public.user_profiles where id = auth.uid() and status = 'active'
  ) then
    raise exception 'Usuario sin acceso para solicitar o revisar horarios' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
    and (new.staff_id, new.requested_date, new.shift_type, new.start_time, new.end_time)
      is not distinct from (old.staff_id, old.requested_date, old.shift_type, old.start_time, old.end_time)
    and not (new.status = 'approved' and old.status is distinct from new.status) then
    return new;
  end if;
  if new.start_time is null and new.end_time is null and new.shift_type <> 'rango' then
    -- Generic opening/middle/closing requests do not identify a concrete shift.
    -- The UI filters its catalogue; the server can still enforce a full day off.
    if exists (select 1 from public.study_schedule_days
      where staff_id = new.staff_id and weekday = extract(isodow from new.requested_date)::integer - 1
        and requests_day_off) then
      raise exception 'El día está marcado como libre en la disponibilidad de estudio' using errcode = '23514';
    end if;
  else
    perform private.assert_shift_study_availability(new.staff_id, new.requested_date, new.start_time, new.end_time);
  end if;
  return new;
end $$;
revoke all on function private.enforce_request_study_availability() from public, anon, authenticated;
create trigger schedule_requests_study_availability
before insert or update of staff_id, requested_date, shift_type, start_time, end_time, status
on public.schedule_requests for each row execute function private.enforce_request_study_availability();

-- The original writer deletes/recreates every day of each changed employee's
-- week. Validate before calling it, comparing logical work times against the
-- existing rows so an unchanged historical conflict cannot block a notes,
-- position or break edit. Existing authorization and holiday sync remain inside
-- private.replace_weekly_schedules and run again independently.
create or replace function public.save_weekly_schedules(p_week_start date, p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  caller public.user_profiles%rowtype;
  staff public.staff_profiles%rowtype;
  change jsonb;
  item jsonb;
  metadata jsonb;
  previous public.schedule_shifts%rowtype;
  v_work_date date;
  start_time time;
  end_time time;
  start2 time;
  end2 time;
  split boolean;
  extra_pre integer;
  extra_post integer;
begin
  select * into caller from public.user_profiles where id = auth.uid();
  if not found or caller.status <> 'active' or caller.role not in ('admin','superadmin') then
    raise exception 'Usuario sin permiso para administrar horarios' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 300 then
    raise exception 'Cambios de horario no válidos' using errcode = '22023';
  end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    select * into staff from public.staff_profiles where id = (change->>'staffId')::uuid;
    if not found then raise exception 'Colaborador no encontrado'; end if;
    if caller.role = 'admin' and staff.store_id is distinct from caller.store_id then
      raise exception 'No tienes permiso para editar otra tienda' using errcode = '42501';
    end if;
    for item in select value from jsonb_array_elements(change->'days') loop
      if coalesce((item->>'off')::boolean, false) or coalesce((item->>'holiday')::boolean, false) then continue; end if;
      start_time := nullif(item->>'start', '')::time;
      end_time := nullif(item->>'end', '')::time;
      if start_time is null and end_time is null then continue; end if;
      v_work_date := (item->>'date')::date;
      metadata := coalesce(item->'metadata', '{}'::jsonb);
      split := coalesce((metadata->>'splitShift')::boolean, false);
      start2 := case when split then nullif(metadata->>'start2', '')::time end;
      end2 := case when split then nullif(metadata->>'end2', '')::time end;
      extra_pre := private.study_extra_minutes(metadata->>'extraHoursPre');
      extra_post := private.study_extra_minutes(coalesce(metadata->>'extraHoursPost', metadata->>'extraHours'));
      select shift.* into previous from public.schedule_shifts shift
        join public.schedule_weeks week on week.id = shift.schedule_week_id
        where week.staff_id = staff.id and week.week_start = p_week_start and shift.work_date = v_work_date;
      if found and not previous.is_day_off and not previous.is_holiday
        and (previous.start_time, previous.end_time,
          coalesce((previous.metadata->>'splitShift')::boolean, false),
          case when split then nullif(previous.metadata->>'start2', '')::time end,
          case when split then nullif(previous.metadata->>'end2', '')::time end,
          private.study_extra_minutes(previous.metadata->>'extraHoursPre'),
          private.study_extra_minutes(coalesce(previous.metadata->>'extraHoursPost', previous.metadata->>'extraHours')))
        is not distinct from (start_time, end_time, split, start2, end2, extra_pre, extra_post) then
        continue;
      end if;
      perform private.assert_shift_study_availability(staff.id, v_work_date, start_time, end_time, extra_pre, extra_post);
      if split then
        perform private.assert_shift_study_availability(staff.id,
          v_work_date + case when start2 < start_time then 1 else 0 end, start2, end2);
      end if;
    end loop;
  end loop;
  return private.replace_weekly_schedules(p_week_start, p_changes);
end $$;
revoke all on function public.save_weekly_schedules(date, jsonb) from public, anon;
grant execute on function public.save_weekly_schedules(date, jsonb) to authenticated;
