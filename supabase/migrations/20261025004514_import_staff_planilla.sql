-- Spreadsheet import creates initial employment profiles only. Existing staff,
-- Auth accounts, linked access, schedules and employment history are untouched.
alter table public.staff_profiles add column if not exists import_source text;
alter table public.staff_profiles add column if not exists import_source_file text;
alter table public.staff_profiles add column if not exists imported_at timestamptz;

-- Only profiles created by this importer use this completion rule. No backfill
-- or existing-row update occurs when the migration is applied.
create function private.sync_planilla_staff_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.import_source is distinct from 'planilla' then return new; end if;
  new.needs_completion := not coalesce(
    nullif(btrim(new.first_name),'') is not null
    and nullif(btrim(new.last_name),'') is not null
    and new.dni ~ '^[0-9]{8}$'
    and new.modality in ('Full-Time','Part-Time')
    and upper(btrim(new.position)) in ('COLABORADOR','ENTRENADOR','ASISTENTE','GERENTE')
    and new.join_date is not null
    and new.sanitary_card_expiry is not null,
    false
  );
  return new;
end;
$$;
revoke all on function private.sync_planilla_staff_completion() from public,anon,authenticated;
create trigger staff_profiles_sync_planilla_completion
before insert or update of first_name,last_name,dni,modality,position,join_date,sanitary_card_expiry
on public.staff_profiles for each row execute function private.sync_planilla_staff_completion();

create function private.import_staff_planilla(
  p_store_id uuid,
  p_rows jsonb,
  p_source_file text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role public.app_role;
  v_status public.record_status;
  v_caller_store uuid;
  v_store_name text;
  v_store_active boolean;
  v_store_area text;
  v_source_file text := nullif(btrim(p_source_file), '');
  v_row jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
  v_index integer := 0;
  v_dni text;
  v_name text;
  v_last_name text;
  v_modality text;
  v_position text;
  v_area text;
  v_existing_count bigint;
  v_existing_current boolean;
  v_id uuid;
  v_created jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_today date := (clock_timestamp() at time zone 'America/Lima')::date;
begin
  if v_caller is null then raise exception 'Sesión no válida'; end if;
  select role, status, store_id into v_role, v_status, v_caller_store
  from public.user_profiles where id = v_caller;
  if not found or v_status is distinct from 'active'::public.record_status
     or v_role not in ('admin','superadmin') then
    raise exception 'Usuario sin permiso para importar colaboradores';
  end if;
  if p_store_id is null then raise exception 'La tienda es obligatoria'; end if;
  if v_role = 'admin' and p_store_id is distinct from v_caller_store then
    raise exception 'No puedes importar colaboradores a otra tienda';
  end if;
  select name, is_active into v_store_name, v_store_active
  from public.stores where id = p_store_id;
  if not found or not v_store_active then raise exception 'La tienda no existe o está inactiva'; end if;
  v_store_area := regexp_replace(upper(normalize(btrim(v_store_name), NFD)), '[^A-Z0-9]', '', 'g');
  if v_source_file is null or char_length(v_source_file) > 240 or v_source_file ~ '[[:cntrl:]]' then
    raise exception 'Nombre de archivo de origen no válido';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'La importación debe contener una lista de colaboradores';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500
     or octet_length(p_rows::text) > 524288 then
    raise exception 'La importación debe contener entre 1 y 500 colaboradores y no superar 512 KB';
  end if;

  -- Validate every row before locking or writing, including skipped identities.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    if jsonb_typeof(v_row) <> 'object' then raise exception 'Fila %: formato no válido', v_index; end if;
    if exists(select 1 from jsonb_object_keys(v_row) as item(key)
      where key <> all(array['dni','name','lastName','modality','position','area'])) then
      raise exception 'Fila %: contiene campos no permitidos', v_index;
    end if;
    if jsonb_typeof(v_row->'dni') is distinct from 'string'
       or jsonb_typeof(v_row->'name') is distinct from 'string'
       or jsonb_typeof(v_row->'lastName') is distinct from 'string'
       or jsonb_typeof(v_row->'modality') is distinct from 'string'
       or jsonb_typeof(v_row->'position') is distinct from 'string'
       or jsonb_typeof(v_row->'area') is distinct from 'string' then
      raise exception 'Fila %: DNI, nombres, modalidad, cargo y área deben ser texto', v_index;
    end if;
    v_dni := btrim(v_row->>'dni');
    v_name := regexp_replace(btrim(v_row->>'name'), '[[:space:]]+', ' ', 'g');
    v_last_name := regexp_replace(btrim(v_row->>'lastName'), '[[:space:]]+', ' ', 'g');
    v_modality := btrim(v_row->>'modality');
    v_position := upper(btrim(v_row->>'position'));
    v_area := regexp_replace(upper(normalize(btrim(v_row->>'area'), NFD)), '[^A-Z0-9]', '', 'g');
    if v_dni !~ '^[0-9]{8}$' then raise exception 'Fila %: el DNI debe tener 8 dígitos', v_index; end if;
    if char_length(v_name) not between 1 and 160 or char_length(v_last_name) not between 1 and 200
       or v_name ~ '[[:cntrl:]]' or v_last_name ~ '[[:cntrl:]]' then
      raise exception 'Fila %: nombre o apellidos no válidos', v_index;
    end if;
    if v_modality not in ('Full-Time','Part-Time')
       or v_position not in ('COLABORADOR','ENTRENADOR','ASISTENTE','GERENTE') then
      raise exception 'Fila %: modalidad o cargo no válidos', v_index;
    end if;
    if char_length(v_row->>'area') > 160 or v_area is distinct from v_store_area then
      raise exception 'Fila %: el área no coincide con la tienda seleccionada', v_index;
    end if;
    if v_dni = any(v_seen) then raise exception 'Fila %: el archivo repite el DNI %', v_index, v_dni; end if;
    v_seen := array_append(v_seen, v_dni);
    v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
      'dni',v_dni,'name',v_name,'lastName',v_last_name,'modality',v_modality,'position',v_position));
  end loop;

  -- Serialize the check and inserts, including concurrent imports. This brief
  -- lock also prevents another writer inserting between this batch's DNI check
  -- and insert. There is deliberately no global unique DNI index: historical
  -- employment records may legitimately share that identity.
  lock table public.staff_profiles in share row exclusive mode;
  for v_row in select value from jsonb_array_elements(v_normalized) loop
    v_dni := v_row->>'dni';
    select count(*), coalesce(bool_or(
      staff.status <> 'inactive'
      and (staff.cessation_date is null or staff.cessation_date >= v_today)
      and (not staff.is_trainee or staff.training_end_date is null or staff.training_end_date >= v_today)
    ),false) into v_existing_count, v_existing_current
    from public.staff_profiles staff
    where staff.store_id = p_store_id
      and regexp_replace(coalesce(staff.dni,''), '[[:space:].-]', '', 'g') = v_dni;
    if v_existing_count > 0 then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('dni',v_dni,
        'reason',case when v_existing_current then 'existing' else 'inactive' end));
      continue;
    end if;
    insert into public.staff_profiles(
      store_id, user_id, first_name, last_name, dni, modality, position,
      status, needs_completion, is_trainee, import_source, import_source_file,
      imported_at, legacy_data
    ) values (
      p_store_id, null, v_row->>'name', v_row->>'lastName', v_dni,
      v_row->>'modality', v_row->>'position', 'pending', true, false,
      'planilla', v_source_file, now(), jsonb_build_object(
        'importedFrom','planilla','sourceFile',v_source_file,'importedAt',now(),'storeName',v_store_name)
    ) returning id into v_id;
    v_created := v_created || jsonb_build_array(jsonb_build_object(
      'id',v_id,'dni',v_dni,'name',v_row->>'name','lastName',v_row->>'lastName',
      'modality',v_row->>'modality','position',v_row->>'position'));
  end loop;
  return jsonb_build_object('created',v_created,'skipped',v_skipped,
    'createdCount',jsonb_array_length(v_created),'skippedCount',jsonb_array_length(v_skipped));
end;
$$;

create function public.import_staff_planilla(
  p_store_id uuid,
  p_rows jsonb,
  p_source_file text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_staff_planilla(p_store_id,p_rows,p_source_file);
$$;

revoke all on function private.import_staff_planilla(uuid,jsonb,text) from public,anon;
revoke all on function public.import_staff_planilla(uuid,jsonb,text) from public,anon;
grant execute on function private.import_staff_planilla(uuid,jsonb,text) to authenticated;
grant execute on function public.import_staff_planilla(uuid,jsonb,text) to authenticated;
comment on function public.import_staff_planilla(uuid,jsonb,text) is
  'Create initial staff profiles from a planilla, within the caller store. Atomic, inserts-only and repeat-safe by DNI; no Auth accounts or existing profiles are changed.';
