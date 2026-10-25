-- Optional per-store access policy. Only a missing document uses defaults; a
-- present document must contain the four correctly typed core fields.
create function private.schedule_access_config_valid(p_config jsonb)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare item jsonb; day_text text; day_value date;
begin
  if jsonb_typeof(p_config) is distinct from 'object'
    or not (p_config ?& array['adminOnlyStudyEditing','requestsEnabled','blockedWeeks','blockedDates'])
    or jsonb_typeof(p_config->'adminOnlyStudyEditing') is distinct from 'boolean'
    or jsonb_typeof(p_config->'requestsEnabled') is distinct from 'boolean'
    or jsonb_typeof(p_config->'blockedWeeks') is distinct from 'array'
    or jsonb_typeof(p_config->'blockedDates') is distinct from 'array' then
    return false;
  end if;
  for item in select value from jsonb_array_elements(p_config->'blockedDates')
    union all select value from jsonb_array_elements(p_config->'blockedWeeks') loop
    if jsonb_typeof(item) <> 'string' then return false; end if;
    day_text := item #>> '{}';
    if day_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    begin day_value := day_text::date;
    exception when invalid_datetime_format or datetime_field_overflow then return false;
    end;
    if to_char(day_value, 'YYYY-MM-DD') <> day_text then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_config->'blockedWeeks') loop
    if extract(isodow from (item #>> '{}')::date) <> 1 then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function private.schedule_access_config_valid(jsonb) from public, anon;
grant execute on function private.schedule_access_config_valid(jsonb) to authenticated;

create function private.read_schedule_access(p_store_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare config jsonb;
begin
  select value into config from public.store_configs
    where store_id = p_store_id and config_key = 'schedule_access';
  if not found then
    return '{"adminOnlyStudyEditing":false,"requestsEnabled":true,"blockedWeeks":[],"blockedDates":[]}'::jsonb;
  end if;
  if not private.schedule_access_config_valid(config) then
    raise exception 'La configuración de acceso de esta tienda no es válida. Administración debe corregirla.' using errcode = '42501';
  end if;
  return config;
end $$;
revoke all on function private.read_schedule_access(uuid) from public, anon;
grant execute on function private.read_schedule_access(uuid) to authenticated;

create function private.validate_schedule_access_config()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare caller public.user_profiles%rowtype;
begin
  if new.config_key <> 'schedule_access' then return new; end if;
  if auth.uid() is not null then
    select * into caller from public.user_profiles where id = auth.uid();
    if not found or caller.status <> 'active' or caller.role not in ('admin','superadmin')
      or (caller.role = 'admin' and caller.store_id is distinct from new.store_id) then
      raise exception 'No tienes permiso para cambiar el acceso de esta tienda' using errcode = '42501';
    end if;
  end if;
  if not private.schedule_access_config_valid(new.value) then
    raise exception 'Configuración de acceso no válida: revisa las opciones y usa fechas válidas y lunes para las semanas.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.validate_schedule_access_config() from public, anon, authenticated;
create trigger store_configs_validate_schedule_access
before insert or update of store_id, config_key, value on public.store_configs
for each row execute function private.validate_schedule_access_config();

-- Enforce the setting at the existing writer's mutations rather than replacing
-- its privileged body: its live authorization, carnet and old schedule_lock
-- checks remain intact, and a failed guard rolls back all seven study days.
create function private.enforce_study_access_policy()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  caller public.user_profiles%rowtype;
  staff public.staff_profiles%rowtype;
  target_staff_id uuid;
  access jsonb;
begin
  -- Server/maintenance writes keep their existing privileges. Anonymous API
  -- users are still denied by the original RPC and table RLS policies.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into caller from public.user_profiles where id = auth.uid();
  if not found or caller.status <> 'active' then
    raise exception 'Usuario sin acceso para editar estudios' using errcode = '42501';
  end if;
  if caller.role = 'superadmin' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'study_schedule_days' then
    target_staff_id := case when tg_op = 'DELETE' then old.staff_id else new.staff_id end;
  else
    select staff_id into target_staff_id from public.study_schedule_days
      where id = case when tg_op = 'DELETE' then old.study_day_id else new.study_day_id end;
  end if;
  select * into staff from public.staff_profiles where id = target_staff_id;
  if not found then
    -- Authorized parent deletes can run this FK cascade after the parent staff
    -- or study day has disappeared. Direct writes still require table RLS, and
    -- account removal independently checks administrative store ownership.
    if caller.role = 'admin' and tg_op = 'DELETE' then return old; end if;
    raise exception 'No tienes permiso para editar esta disponibilidad' using errcode = '42501';
  end if;
  if caller.role = 'admin' then
    -- Explicitly check ownership here too: a legacy writer's nullable self-link
    -- branch must never turn a foreign-store authorization predicate into NULL.
    if caller.store_id is distinct from staff.store_id then
      raise exception 'No tienes permiso para editar esta disponibilidad' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if staff.user_id is distinct from auth.uid() or staff.store_id is distinct from caller.store_id then
    raise exception 'No tienes permiso para editar esta disponibilidad' using errcode = '42501';
  end if;
  access := private.read_schedule_access(staff.store_id);
  if (access->>'adminOnlyStudyEditing')::boolean then
    raise exception 'La edición de estudios está habilitada solo para administradores de la tienda.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.enforce_study_access_policy() from public, anon, authenticated;
create trigger study_days_enforce_access_policy
before insert or update or delete on public.study_schedule_days
for each row execute function private.enforce_study_access_policy();
create trigger study_blocks_enforce_access_policy
before insert or update or delete on public.study_schedule_blocks
for each row execute function private.enforce_study_access_policy();

-- Restrictions on dates apply only to new requests. Pending/historical records
-- remain present and their existing review permissions are unchanged.
create function private.enforce_request_access_policy()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare access jsonb; week_start date; legacy_lock jsonb; legacy_lock_date text;
begin
  -- Keep the earlier temporary closure authoritative even on deployments whose
  -- newer identity RLS policy no longer contains its original lock predicate.
  -- This SELECT retains caller RLS visibility and does not use a definer helper.
  select value into legacy_lock from public.store_configs
    where store_id = new.store_id and config_key = 'schedule_lock';
  legacy_lock_date := nullif(legacy_lock->>'reenableDate', '');
  if coalesce((legacy_lock->>'restrictionsEnabled')::boolean, false)
    and legacy_lock_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    and (now() at time zone 'America/Lima')::date <= legacy_lock_date::date then
    raise exception 'Cambios temporalmente bloqueados' using errcode = '42501';
  end if;
  access := private.read_schedule_access(new.store_id);
  if not (access->>'requestsEnabled')::boolean then
    raise exception 'Las solicitudes de horario están deshabilitadas para esta tienda.' using errcode = '42501';
  end if;
  if (access->'blockedDates') ? to_char(new.requested_date, 'YYYY-MM-DD') then
    raise exception 'No se permiten solicitudes para la fecha seleccionada.' using errcode = '42501';
  end if;
  week_start := new.requested_date - (extract(isodow from new.requested_date)::integer - 1);
  if (access->'blockedWeeks') ? to_char(week_start, 'YYYY-MM-DD') then
    raise exception 'No se permiten solicitudes para la semana seleccionada.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.enforce_request_access_policy() from public, anon, authenticated;
create trigger schedule_requests_access_policy
before insert on public.schedule_requests for each row execute function private.enforce_request_access_policy();

-- Self-service removal is deliberately narrower than administrative deletion:
-- only the live account's linked, own-store request that is still unreviewed.
alter table public.schedule_requests enable row level security;
grant delete on public.schedule_requests to authenticated;
create policy schedule_requests_own_pending_delete on public.schedule_requests
for delete to authenticated using (
  status = 'pending' and reviewed_by is null and reviewed_at is null
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.user_profiles caller
    join public.staff_profiles staff on staff.id = schedule_requests.staff_id
    where caller.id = (select auth.uid()) and caller.status = 'active'
      and caller.role in ('collaborator','trainer')
      and caller.staff_profile_id = staff.id and staff.user_id = caller.id
      and caller.store_id = staff.store_id and schedule_requests.store_id = staff.store_id
  )
);

-- Merge a form's intent under a row lock. Reading and writing the document in
-- separate browser requests can lose another administrator's newly added date.
-- Unknown metadata comes only from the locked current document, never the draft.
create function public.update_schedule_access(p_store_id uuid, p_original jsonb, p_draft jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  caller public.user_profiles%rowtype;
  current_config jsonb;
  merged_config jsonb;
  merged_dates jsonb;
  field text;
begin
  select * into caller from public.user_profiles where id = auth.uid();
  if not found or caller.status <> 'active' or caller.role not in ('admin','superadmin')
    or p_store_id is null
    or (caller.role = 'admin' and caller.store_id is distinct from p_store_id) then
    raise exception 'No tienes permiso para cambiar el acceso de esta tienda' using errcode = '42501';
  end if;
  if not private.schedule_access_config_valid(p_original)
    or not private.schedule_access_config_valid(p_draft) then
    raise exception 'Configuración de acceso no válida: revisa las opciones y usa fechas válidas y lunes para las semanas.' using errcode = '23514';
  end if;

  insert into public.store_configs(store_id, config_key, value, updated_by)
  values (p_store_id, 'schedule_access',
    '{"adminOnlyStudyEditing":false,"requestsEnabled":true,"blockedWeeks":[],"blockedDates":[]}'::jsonb,
    auth.uid())
  on conflict(store_id, config_key) do nothing;
  select value into current_config from public.store_configs
    where store_id = p_store_id and config_key = 'schedule_access' for update;
  if not found then
    raise exception 'No tienes permiso para cambiar el acceso de esta tienda' using errcode = '42501';
  end if;
  if not private.schedule_access_config_valid(current_config) then
    raise exception 'La configuración de acceso de esta tienda no es válida. Administración debe corregirla.' using errcode = '42501';
  end if;

  merged_config := current_config;
  foreach field in array array['adminOnlyStudyEditing','requestsEnabled'] loop
    if p_original->field is distinct from p_draft->field then
      merged_config := jsonb_set(merged_config, array[field], p_draft->field, true);
    end if;
  end loop;
  foreach field in array array['blockedWeeks','blockedDates'] loop
    -- No changed set members means no edit intent, including mere reordering.
    if not exists (
      (select value from jsonb_array_elements_text(p_original->field)
        except select value from jsonb_array_elements_text(p_draft->field))
      union all
      (select value from jsonb_array_elements_text(p_draft->field)
        except select value from jsonb_array_elements_text(p_original->field))
    ) then continue; end if;
    with original_dates as (select value from jsonb_array_elements_text(p_original->field)),
      draft_dates as (select value from jsonb_array_elements_text(p_draft->field)),
      removed_dates as (select value from original_dates except select value from draft_dates),
      added_dates as (select value from draft_dates except select value from original_dates),
      kept_dates as (
        select value from jsonb_array_elements_text(current_config->field)
        except select value from removed_dates
      ),
      combined_dates as (select value from kept_dates union select value from added_dates)
    select coalesce(jsonb_agg(value order by value), '[]'::jsonb) into merged_dates from combined_dates;
    merged_config := jsonb_set(merged_config, array[field], merged_dates, true);
  end loop;

  if merged_config is distinct from current_config then
    update public.store_configs set value = merged_config, updated_by = auth.uid(), updated_at = now()
      where store_id = p_store_id and config_key = 'schedule_access';
  end if;
  return merged_config;
end $$;
revoke all on function public.update_schedule_access(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.update_schedule_access(uuid, jsonb, jsonb) to authenticated;
notify pgrst, 'reload schema';
