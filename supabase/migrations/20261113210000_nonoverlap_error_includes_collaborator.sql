-- Mejora SOLO el mensaje de error de solapamiento de turnos: agrega el nombre
-- del colaborador y los horarios que chocan, para que el administrador sepa a
-- quién corregir. La lógica de detección de solapes reales NO cambia.
--
-- Nota: esta función vivía únicamente en la base de datos de producción y no
-- estaba versionada en el repo. Se reincorpora aquí con el mensaje mejorado.
create or replace function private.assert_weekly_shift_nonoverlap(p_staff_id uuid, p_week_start date, p_days jsonb)
  returns void language plpgsql set search_path to '' as $function$
declare
  caller public.user_profiles%rowtype;
  staff public.staff_profiles%rowtype;
  conflict record;
begin
  select * into caller from public.user_profiles where id = auth.uid();
  if not found or caller.status <> 'active' or caller.role not in ('admin','superadmin') then
    raise exception 'Usuario sin permiso para administrar horarios' using errcode = '42501';
  end if;
  select * into staff from public.staff_profiles where id = p_staff_id;
  if not found then raise exception 'Colaborador no encontrado'; end if;
  if caller.role = 'admin' and staff.store_id is distinct from caller.store_id then
    raise exception 'No tienes permiso para editar otra tienda' using errcode = '42501';
  end if;

  with proposed_days as (
    select 'new:' || ordinal::text as shift_key,
      (item->>'date')::date as work_date,
      nullif(item->>'start', '')::time as start_time,
      nullif(item->>'end', '')::time as end_time,
      coalesce((item->>'off')::boolean, false) as is_day_off,
      coalesce((item->>'holiday')::boolean, false) as is_holiday,
      coalesce(item->'metadata', '{}'::jsonb) as metadata
    from jsonb_array_elements(p_days) with ordinality proposed(item, ordinal)
  ), proposed_work as (
    select proposed.*, coalesce((metadata->>'splitShift')::boolean, false) as split,
      case when coalesce((metadata->>'splitShift')::boolean, false)
        then nullif(metadata->>'start2', '')::time end as start2,
      case when coalesce((metadata->>'splitShift')::boolean, false)
        then nullif(metadata->>'end2', '')::time end as end2,
      private.study_extra_minutes(metadata->>'extraHoursPre') as extra_pre,
      private.study_extra_minutes(coalesce(metadata->>'extraHoursPost', metadata->>'extraHours')) as extra_post
    from proposed_days proposed
    where not is_day_off and not is_holiday and start_time is not null and end_time is not null
  ), proposed_intervals as (
    select proposed.*, not exists (
      select 1 from public.schedule_shifts previous
      join public.schedule_weeks week on week.id = previous.schedule_week_id
      where week.staff_id = p_staff_id and week.week_start = p_week_start
        and previous.work_date = proposed.work_date
        and not previous.is_day_off and not previous.is_holiday
        and (previous.start_time, previous.end_time,
          coalesce((previous.metadata->>'splitShift')::boolean, false),
          case when proposed.split then nullif(previous.metadata->>'start2', '')::time end,
          case when proposed.split then nullif(previous.metadata->>'end2', '')::time end,
          private.study_extra_minutes(previous.metadata->>'extraHoursPre'),
          private.study_extra_minutes(coalesce(previous.metadata->>'extraHoursPost', previous.metadata->>'extraHours')))
        is not distinct from (proposed.start_time, proposed.end_time, proposed.split,
          proposed.start2, proposed.end2, proposed.extra_pre, proposed.extra_post)
    ) as timing_changed
    from proposed_work proposed
  ), all_work as (
    select shift_key, work_date, start_time, end_time, split, start2, end2,
      extra_pre, extra_post, timing_changed from proposed_intervals
    union all
    select 'saved:' || shift.id::text, shift.work_date, shift.start_time, shift.end_time,
      coalesce((shift.metadata->>'splitShift')::boolean, false),
      case when coalesce((shift.metadata->>'splitShift')::boolean, false)
        then nullif(shift.metadata->>'start2', '')::time end,
      case when coalesce((shift.metadata->>'splitShift')::boolean, false)
        then nullif(shift.metadata->>'end2', '')::time end,
      private.study_extra_minutes(shift.metadata->>'extraHoursPre'),
      private.study_extra_minutes(coalesce(shift.metadata->>'extraHoursPost', shift.metadata->>'extraHours')),
      false
    from public.schedule_shifts shift
    join public.schedule_weeks week on week.id = shift.schedule_week_id
    where week.staff_id = p_staff_id and week.week_start <> p_week_start
      and not shift.is_day_off and not shift.is_holiday
      and shift.start_time is not null and shift.end_time is not null
  ), segments as (
    select shift_key || ':1' as segment_key, work_date, timing_changed,
      work_date + start_time - make_interval(mins => extra_pre) as work_start,
      work_date + end_time + case when end_time < start_time then interval '1 day' else interval '0 day' end
        + make_interval(mins => extra_post) as work_end
    from all_work
    union all
    select shift_key || ':2', work_date, timing_changed,
      work_date + start2 + case when start2 < start_time then interval '1 day' else interval '0 day' end,
      work_date + end2 + case when start2 < start_time then interval '1 day' else interval '0 day' end
        + case when end2 < start2 then interval '1 day' else interval '0 day' end
    from all_work where split and start2 is not null and end2 is not null
  )
  select proposed.work_date as work_date, other.work_date as other_date,
    proposed.work_start as ws, proposed.work_end as we,
    other.work_start as other_ws, other.work_end as other_we into conflict
  from segments proposed join segments other on proposed.segment_key <> other.segment_key
  where proposed.timing_changed and proposed.work_start < other.work_end and proposed.work_end > other.work_start
  order by proposed.work_date, other.work_date limit 1;
  if found then
    raise exception 'El turno del % de % (%-%) se superpone con otro horario del % (%-%) del mismo colaborador',
      to_char(conflict.work_date, 'DD/MM/YYYY'),
      trim(coalesce(staff.first_name, '') || ' ' || coalesce(staff.last_name, '')),
      to_char(conflict.ws, 'HH24:MI'), to_char(conflict.we, 'HH24:MI'),
      to_char(conflict.other_date, 'DD/MM/YYYY'),
      to_char(conflict.other_ws, 'HH24:MI'), to_char(conflict.other_we, 'HH24:MI')
      using errcode = '23514';
  end if;
end $function$;
