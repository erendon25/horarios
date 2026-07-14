-- Horarios de estudio: reemplazo atómico de los siete días y sus bloques.

create or replace function private.replace_study_schedule(
  p_staff_id uuid,
  p_schedule jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role public.app_role;
  v_caller_status public.record_status;
  v_caller_store uuid;
  v_staff public.staff_profiles%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_lock jsonb;
  v_day_keys constant text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_weekday integer;
  v_day_key text;
  v_day jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_day_id bigint;
  v_free boolean;
  v_start time;
  v_end time;
begin
  if v_caller_id is null then raise exception 'Sesión no válida'; end if;
  if jsonb_typeof(p_schedule) <> 'object' then raise exception 'Horario no válido'; end if;

  select role, status, store_id into v_caller_role, v_caller_status, v_caller_store
  from public.user_profiles where id = v_caller_id;
  if not found or v_caller_status <> 'active' then raise exception 'Usuario sin acceso'; end if;

  select * into v_staff from public.staff_profiles where id = p_staff_id;
  if not found then raise exception 'Colaborador no encontrado'; end if;

  if not (
    v_caller_role = 'superadmin'
    or (v_caller_role = 'admin' and v_caller_store = v_staff.store_id)
    or v_staff.user_id = v_caller_id
  ) then
    raise exception 'No tienes permiso para editar esta disponibilidad';
  end if;

  -- Los administradores conservan la capacidad histórica de corregir horarios.
  if v_caller_role not in ('admin', 'superadmin') then
    if v_staff.sanitary_card_expiry is not null
       and v_today > v_staff.sanitary_card_expiry
       and not coalesce(v_staff.sanitary_card_unlock, false) then
      raise exception 'Carnet sanitario vencido';
    end if;

    select value into v_lock from public.store_configs
    where store_id = v_staff.store_id and config_key = 'schedule_lock';
    if coalesce((v_lock->>'restrictionsEnabled')::boolean, false)
       and coalesce(v_lock->>'reenableDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
       and v_today <= (v_lock->>'reenableDate')::date then
      raise exception 'Cambios temporalmente bloqueados';
    end if;
  end if;

  for v_weekday in 0..6 loop
    v_day_key := v_day_keys[v_weekday + 1];
    v_day := coalesce(p_schedule->v_day_key, '{}'::jsonb);
    if jsonb_typeof(v_day) <> 'object' then raise exception 'Día no válido: %', v_day_key; end if;
    v_free := coalesce((v_day->>'free')::boolean, false);
    v_blocks := coalesce(v_day->'blocks', '[]'::jsonb);
    if jsonb_typeof(v_blocks) <> 'array' then raise exception 'Bloques no válidos: %', v_day_key; end if;

    insert into public.study_schedule_days (staff_id, weekday, requests_day_off, updated_at)
    values (p_staff_id, v_weekday, v_free, now())
    on conflict (staff_id, weekday) do update set
      requests_day_off = excluded.requests_day_off,
      updated_at = now()
    returning id into v_day_id;

    delete from public.study_schedule_blocks where study_day_id = v_day_id;
    if not v_free then
      for v_block in select value from jsonb_array_elements(v_blocks) loop
        if jsonb_typeof(v_block) <> 'object'
           or nullif(v_block->>'start', '') is null
           or nullif(v_block->>'end', '') is null then
          raise exception 'Completa las horas de inicio y fin en %', v_day_key;
        end if;
        v_start := (v_block->>'start')::time;
        v_end := (v_block->>'end')::time;
        if v_start = v_end then raise exception 'Inicio y fin no pueden ser iguales en %', v_day_key; end if;
        insert into public.study_schedule_blocks (study_day_id, start_time, end_time, metadata)
        values (v_day_id, v_start, v_end, v_block);
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function private.replace_study_schedule(uuid, jsonb) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.replace_study_schedule(uuid, jsonb) to authenticated;

create or replace function public.save_study_schedule(p_staff_id uuid, p_schedule jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.replace_study_schedule(p_staff_id, p_schedule);
$$;

revoke all on function public.save_study_schedule(uuid, jsonb) from public, anon;
grant execute on function public.save_study_schedule(uuid, jsonb) to authenticated;

drop policy if exists study_days_write on public.study_schedule_days;
drop policy if exists study_days_admin_write on public.study_schedule_days;
drop policy if exists study_days_admin_insert on public.study_schedule_days;
drop policy if exists study_days_admin_update on public.study_schedule_days;
drop policy if exists study_days_admin_delete on public.study_schedule_days;
create policy study_days_admin_insert on public.study_schedule_days for insert to authenticated
  with check (
    (select private.current_user_role()) = 'superadmin'
    or exists (
      select 1 from public.staff_profiles sp where sp.id = staff_id
        and sp.store_id = (select private.current_user_store_id())
        and (select private.current_user_role()) = 'admin'
    )
  );

create policy study_days_admin_update on public.study_schedule_days for update to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or exists (
      select 1 from public.staff_profiles sp where sp.id = staff_id
        and sp.store_id = (select private.current_user_store_id())
        and (select private.current_user_role()) = 'admin'
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or exists (
      select 1 from public.staff_profiles sp where sp.id = staff_id
        and sp.store_id = (select private.current_user_store_id())
        and (select private.current_user_role()) = 'admin'
    )
  );

create policy study_days_admin_delete on public.study_schedule_days for delete to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or exists (
      select 1 from public.staff_profiles sp where sp.id = staff_id
        and sp.store_id = (select private.current_user_store_id())
        and (select private.current_user_role()) = 'admin'
    )
  );

drop policy if exists study_blocks_write on public.study_schedule_blocks;
drop policy if exists study_blocks_admin_write on public.study_schedule_blocks;
drop policy if exists study_blocks_admin_insert on public.study_schedule_blocks;
drop policy if exists study_blocks_admin_update on public.study_schedule_blocks;
drop policy if exists study_blocks_admin_delete on public.study_schedule_blocks;
create policy study_blocks_admin_insert on public.study_schedule_blocks for insert to authenticated
  with check (
    exists (
      select 1 from public.study_schedule_days sd
      join public.staff_profiles sp on sp.id = sd.staff_id
      where sd.id = study_day_id
        and (
          (select private.current_user_role()) = 'superadmin'
          or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
        )
    )
  );

create policy study_blocks_admin_update on public.study_schedule_blocks for update to authenticated
  using (
    exists (
      select 1 from public.study_schedule_days sd
      join public.staff_profiles sp on sp.id = sd.staff_id
      where sd.id = study_day_id
        and (
          (select private.current_user_role()) = 'superadmin'
          or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
        )
    )
  )
  with check (
    exists (
      select 1 from public.study_schedule_days sd
      join public.staff_profiles sp on sp.id = sd.staff_id
      where sd.id = study_day_id
        and (
          (select private.current_user_role()) = 'superadmin'
          or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
        )
    )
  );

create policy study_blocks_admin_delete on public.study_schedule_blocks for delete to authenticated
  using (
    exists (
      select 1 from public.study_schedule_days sd
      join public.staff_profiles sp on sp.id = sd.staff_id
      where sd.id = study_day_id
        and (
          (select private.current_user_role()) = 'superadmin'
          or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
        )
    )
  );
