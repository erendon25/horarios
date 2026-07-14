-- Horario semanal: catálogo legal y guardado atómico de semanas, turnos y feriados.

create table if not exists public.official_holidays (
  holiday_date date primary key,
  country_code text not null default 'PE' check (country_code = 'PE'),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.official_holidays enable row level security;
grant select on table public.official_holidays to authenticated, service_role;
revoke insert, update, delete on table public.official_holidays from anon, authenticated;
drop policy if exists official_holidays_read on public.official_holidays;
create policy official_holidays_read on public.official_holidays
  for select to authenticated using (true);

insert into public.official_holidays (holiday_date, name) values
  ('2024-01-01','Año Nuevo'),('2024-03-28','Jueves Santo'),('2024-03-29','Viernes Santo'),
  ('2024-05-01','Día del Trabajo'),('2024-06-07','Batalla de Arica y Día de la Bandera'),
  ('2024-06-29','San Pedro y San Pablo'),('2024-07-23','Día de la Fuerza Aérea del Perú'),
  ('2024-07-28','Fiestas Patrias'),('2024-07-29','Fiestas Patrias'),('2024-08-06','Batalla de Junín'),
  ('2024-08-30','Santa Rosa de Lima'),('2024-10-08','Combate de Angamos'),
  ('2024-11-01','Día de Todos los Santos'),('2024-12-08','Inmaculada Concepción'),
  ('2024-12-09','Batalla de Ayacucho'),('2024-12-25','Navidad'),
  ('2025-01-01','Año Nuevo'),('2025-04-17','Jueves Santo'),('2025-04-18','Viernes Santo'),
  ('2025-05-01','Día del Trabajo'),('2025-06-07','Batalla de Arica y Día de la Bandera'),
  ('2025-06-29','San Pedro y San Pablo'),('2025-07-23','Día de la Fuerza Aérea del Perú'),
  ('2025-07-28','Fiestas Patrias'),('2025-07-29','Fiestas Patrias'),('2025-08-06','Batalla de Junín'),
  ('2025-08-30','Santa Rosa de Lima'),('2025-10-08','Combate de Angamos'),
  ('2025-11-01','Día de Todos los Santos'),('2025-12-08','Inmaculada Concepción'),
  ('2025-12-09','Batalla de Ayacucho'),('2025-12-25','Navidad'),
  ('2026-01-01','Año Nuevo'),('2026-04-02','Jueves Santo'),('2026-04-03','Viernes Santo'),
  ('2026-05-01','Día del Trabajo'),('2026-06-07','Batalla de Arica y Día de la Bandera'),
  ('2026-06-29','Día de San Pedro y San Pablo'),('2026-07-23','Día de la Fuerza Aérea del Perú'),
  ('2026-07-28','Fiestas Patrias'),('2026-07-29','Fiestas Patrias'),('2026-08-06','Batalla de Junín'),
  ('2026-08-30','Santa Rosa de Lima'),('2026-10-08','Combate de Angamos'),
  ('2026-11-01','Día de Todos los Santos'),('2026-12-08','Inmaculada Concepción'),
  ('2026-12-09','Batalla de Ayacucho'),('2026-12-25','Navidad')
on conflict (holiday_date) do update set name = excluded.name;

create or replace function private.replace_weekly_schedules(
  p_week_start date,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_role public.app_role;
  v_status public.record_status;
  v_store_id uuid;
  v_change jsonb;
  v_staff public.staff_profiles%rowtype;
  v_week_id bigint;
  v_day jsonb;
  v_date date;
  v_start time;
  v_end time;
  v_start2 time;
  v_end2 time;
  v_off boolean;
  v_holiday boolean;
  v_metadata jsonb;
  v_holiday_name text;
  v_saved_staff integer := 0;
  v_saved_shifts integer := 0;
begin
  if v_caller_id is null then raise exception 'Sesión no válida'; end if;
  select role, status, store_id into v_role, v_status, v_store_id
  from public.user_profiles where id = v_caller_id;
  if not found or v_status <> 'active' or v_role not in ('admin','superadmin') then
    raise exception 'Usuario sin permiso para administrar horarios';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'La semana debe comenzar un lunes';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0
     or jsonb_array_length(p_changes) > 300 then
    raise exception 'Cambios de horario no válidos';
  end if;
  if (select count(*) from jsonb_array_elements(p_changes)) <>
     (select count(distinct value->>'staffId') from jsonb_array_elements(p_changes)) then
    raise exception 'No se puede repetir un colaborador';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    if jsonb_typeof(v_change) <> 'object' or nullif(v_change->>'staffId','') is null
       or jsonb_typeof(v_change->'days') <> 'array' then
      raise exception 'Colaborador o días no válidos';
    end if;
    select * into v_staff from public.staff_profiles where id = (v_change->>'staffId')::uuid;
    if not found then raise exception 'Colaborador no encontrado'; end if;
    if v_role = 'admin' and v_staff.store_id <> v_store_id then
      raise exception 'No tienes permiso para editar otra tienda';
    end if;
    if jsonb_array_length(v_change->'days') > 7 then
      raise exception 'Una semana no puede tener más de siete días';
    end if;
    if (select count(*) from jsonb_array_elements(v_change->'days')) <>
       (select count(distinct value->>'date') from jsonb_array_elements(v_change->'days')) then
      raise exception 'No se puede repetir una fecha';
    end if;

    insert into public.schedule_weeks (staff_id, store_id, week_start, updated_at, legacy_data)
    values (v_staff.id, v_staff.store_id, p_week_start, now(), jsonb_build_object('source','next-weekly-editor'))
    on conflict (staff_id, week_start) do update set
      store_id = excluded.store_id,
      updated_at = now(),
      legacy_data = public.schedule_weeks.legacy_data || jsonb_build_object('lastSource','next-weekly-editor')
    returning id into v_week_id;

    delete from public.schedule_shifts where schedule_week_id = v_week_id;
    delete from public.worked_holidays
    where staff_id = v_staff.id and holiday_date between p_week_start and p_week_start + 6;

    for v_day in select value from jsonb_array_elements(v_change->'days') loop
      if jsonb_typeof(v_day) <> 'object' or nullif(v_day->>'date','') is null then
        raise exception 'Día de horario no válido';
      end if;
      v_date := (v_day->>'date')::date;
      if v_date < p_week_start or v_date > p_week_start + 6 then
        raise exception 'La fecha % no pertenece a la semana', v_date;
      end if;
      v_off := coalesce((v_day->>'off')::boolean, false);
      v_holiday := coalesce((v_day->>'holiday')::boolean, false);
      if v_off and v_holiday then raise exception 'Un día no puede ser libre y feriado compensado'; end if;
      v_metadata := coalesce(v_day->'metadata','{}'::jsonb);
      if jsonb_typeof(v_metadata) <> 'object' then raise exception 'Metadatos no válidos'; end if;
      v_start := nullif(v_day->>'start','')::time;
      v_end := nullif(v_day->>'end','')::time;
      v_start2 := nullif(v_metadata->>'start2','')::time;
      v_end2 := nullif(v_metadata->>'end2','')::time;

      select name into v_holiday_name from public.official_holidays where holiday_date = v_date;
      if v_holiday and v_holiday_name is not null then
        raise exception 'Un feriado oficial debe marcarse como descanso legal o turno trabajado';
      end if;
      if not v_off and (v_start is null) <> (v_end is null) then
        raise exception 'Completa inicio y fin del turno';
      end if;
      if v_start is not null and v_start = v_end then raise exception 'Inicio y fin no pueden ser iguales'; end if;
      if coalesce((v_metadata->>'splitShift')::boolean,false) and
         (v_start2 is null or v_end2 is null or v_start2 = v_end2) then
        raise exception 'Completa correctamente el segundo turno';
      end if;
      if coalesce((v_metadata->>'extraHoursPre')::numeric,0) < 0 or
         coalesce((coalesce(v_metadata->>'extraHoursPost',v_metadata->>'extraHours'))::numeric,0) < 0 then
        raise exception 'Las horas extra no pueden ser negativas';
      end if;

      -- Los días completamente vacíos se representan por ausencia de fila.
      if v_off or v_holiday or v_start is not null then
        insert into public.schedule_shifts (
          schedule_week_id, work_date, start_time, end_time, position,
          is_day_off, is_holiday, notes, metadata
        ) values (
          v_week_id, v_date,
          case when v_off then null else v_start end,
          case when v_off then null else v_end end,
          case when v_off then null else nullif(v_day->>'position','') end,
          v_off, v_holiday, nullif(v_day->>'notes',''),
          v_metadata || jsonb_build_object(
            'start', coalesce(v_day->>'start',''), 'end', coalesce(v_day->>'end',''),
            'position', coalesce(v_day->>'position',''), 'off', v_off, 'feriado', v_holiday
          )
        );
        v_saved_shifts := v_saved_shifts + 1;
      end if;

      if v_holiday then
        insert into public.worked_holidays (staff_id, user_id, store_id, holiday_date, name, balance_type, legacy_data)
        values (v_staff.id, v_staff.user_id, v_staff.store_id, v_date, 'Compensación de Feriado', 'compensado', jsonb_build_object('source','next-weekly-editor'));
      elsif not v_off and v_start is not null and v_holiday_name is not null then
        insert into public.worked_holidays (staff_id, user_id, store_id, holiday_date, name, balance_type, legacy_data)
        values (v_staff.id, v_staff.user_id, v_staff.store_id, v_date, v_holiday_name, 'ganado', jsonb_build_object('source','next-weekly-editor'));
      end if;
    end loop;
    v_saved_staff := v_saved_staff + 1;
  end loop;

  return jsonb_build_object('savedStaff',v_saved_staff,'savedShifts',v_saved_shifts);
end;
$$;

revoke all on function private.replace_weekly_schedules(date, jsonb) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.replace_weekly_schedules(date, jsonb) to authenticated;

create or replace function public.save_weekly_schedules(p_week_start date, p_changes jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.replace_weekly_schedules(p_week_start, p_changes); $$;

revoke all on function public.save_weekly_schedules(date, jsonb) from public, anon;
grant execute on function public.save_weekly_schedules(date, jsonb) to authenticated;

-- Las escrituras del horario deben pasar por la función para mantener sincronizados los feriados.
grant select on public.schedule_weeks, public.schedule_shifts, public.worked_holidays to authenticated;
revoke insert, update, delete on public.schedule_weeks, public.schedule_shifts, public.worked_holidays from authenticated;

-- Al no existir escrituras directas, estas políticas FOR ALL solo duplicaban la evaluación SELECT.
drop policy if exists schedule_weeks_admin_write on public.schedule_weeks;
drop policy if exists schedule_shifts_admin_write on public.schedule_shifts;
drop policy if exists worked_holidays_write on public.worked_holidays;
