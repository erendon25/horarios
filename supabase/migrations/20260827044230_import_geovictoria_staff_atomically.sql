-- GeoVictoria roster imports must not commit a bare staff row and then depend
-- on a second RPC to mark its provenance.  Keep searchable provenance on the
-- staff row and perform the create + import-state transition in one transaction.
alter table public.staff_profiles
  add column if not exists import_source text,
  add column if not exists import_source_file text,
  add column if not exists imported_at timestamptz;

-- Preserve provenance written by the former two-step mark_staff_import_state
-- flow.  created_at is a safe fallback when a legacy timestamp is absent or was
-- not stored as a typed value.
update public.staff_profiles staff
set import_source = coalesce(
      staff.import_source,
      nullif(lower(btrim(staff.legacy_data ->> 'import_source')), ''),
      nullif(lower(btrim(staff.legacy_data ->> 'importedFrom')), '')
    ),
    import_source_file = coalesce(
      staff.import_source_file,
      nullif(btrim(staff.legacy_data ->> 'import_source_file'), ''),
      nullif(btrim(staff.legacy_data ->> 'sourceFile'), '')
    ),
    imported_at = coalesce(staff.imported_at, staff.created_at)
where staff.import_source is not null
   or nullif(btrim(staff.legacy_data ->> 'import_source'), '') is not null
   or nullif(btrim(staff.legacy_data ->> 'importedFrom'), '') is not null;

alter table public.staff_profiles
  add constraint staff_profiles_import_source_check
    check (import_source is null or length(btrim(import_source)) between 1 and 100),
  add constraint staff_profiles_import_source_file_check
    check (import_source_file is null or length(import_source_file) <= 500),
  add constraint staff_profiles_import_provenance_check
    check (
      import_source is not null
      or (import_source_file is null and imported_at is null)
    );

create index if not exists staff_profiles_import_identity_idx
  on public.staff_profiles (
    store_id,
    import_source,
    (regexp_replace(coalesce(dni, ''), '[^0-9]', '', 'g'))
  )
  where import_source is not null;

create or replace function public.import_geovictoria_staff_profile(
  p_store_id uuid,
  p_first_name text,
  p_last_name text,
  p_dni text,
  p_email text default null,
  p_join_date date default null,
  p_source_file text default null
)
returns table (
  staff_id uuid,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_caller_store_id uuid := private.current_user_store_id();
  v_normalized_dni text := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
  v_normalized_email text := nullif(lower(btrim(p_email)), '');
  v_source constant text := 'geovictoria';
  v_today date := (now() at time zone 'America/Lima')::date;
  v_current_ids uuid[];
  v_staff_id uuid;
begin
  if (select auth.uid()) is null
     or v_role is null
     or v_role not in ('admin', 'superadmin') then
    raise exception using
      errcode = '42501',
      message = 'No tienes permiso para importar colaboradores';
  end if;

  if p_store_id is null
     or not exists (
       select 1
       from public.stores store
       where store.id = p_store_id
         and store.is_active
     ) then
    raise exception using errcode = '22023', message = 'La tienda de importación no está activa';
  end if;

  if v_role = 'admin' and v_caller_store_id is distinct from p_store_id then
    raise exception using errcode = '42501', message = 'No puedes importar colaboradores de otra tienda';
  end if;

  if length(v_normalized_dni) < 6 or length(v_normalized_dni) > 15 then
    raise exception using errcode = '22023', message = 'DNI inválido';
  end if;

  if v_normalized_email is not null
     and v_normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Correo inválido';
  end if;

  if length(coalesce(p_source_file, '')) > 500 then
    raise exception using errcode = '22023', message = 'Nombre de archivo de importación inválido';
  end if;

  -- Serialize retries (and concurrent browser tabs) for the canonical import
  -- identity before checking for an existing staff row.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_store_id::text || ':' || v_normalized_dni || ':' || v_source,
      0
    )
  );

  if v_normalized_email is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('staff-email:' || v_normalized_email, 0)
    );
  end if;

  select coalesce(
    array_agg(staff.id order by staff.created_at, staff.id),
    '{}'::uuid[]
  )
  into v_current_ids
  from public.staff_profiles staff
  where staff.store_id = p_store_id
    and regexp_replace(coalesce(staff.dni, ''), '[^0-9]', '', 'g') = v_normalized_dni
    and staff.status <> 'inactive'
    and (staff.cessation_date is null or staff.cessation_date >= v_today)
    and (
      not staff.is_trainee
      or staff.training_end_date is null
      or staff.training_end_date >= v_today
    );

  if cardinality(v_current_ids) > 1 then
    raise exception using
      errcode = '23505',
      message = 'El DNI ya corresponde a más de un episodio vigente; resuelve la ambigüedad antes de importar';
  end if;

  if cardinality(v_current_ids) = 1 then
    return query select v_current_ids[1], false;
    return;
  end if;

  -- Ended employment/training episodes are history, not an idempotency key.
  -- With no current episode, a rehire receives a new staff row.  The advisory
  -- lock above makes the first imported pending row the stable retry target.

  if v_normalized_email is not null
     and exists (
       select 1
       from public.staff_profiles staff
       where nullif(lower(btrim(staff.email)), '') = v_normalized_email
         and staff.status <> 'inactive'
         and (staff.cessation_date is null or staff.cessation_date >= v_today)
         and (
           not staff.is_trainee
           or staff.training_end_date is null
           or staff.training_end_date >= v_today
         )
     ) then
    raise exception using
      errcode = '23505',
      message = 'El correo ya corresponde a otro colaborador vigente';
  end if;

  v_staff_id := public.save_staff_profile(
    null,
    p_store_id,
    p_first_name,
    p_last_name,
    v_normalized_email,
    v_normalized_dni,
    null,
    null,
    null,
    'COLABORADOR',
    'pending'::public.record_status,
    p_join_date,
    null,
    false,
    false,
    null,
    null,
    null
  );

  update public.staff_profiles staff
  set needs_completion = true,
      import_source = v_source,
      import_source_file = nullif(btrim(p_source_file), ''),
      imported_at = now(),
      legacy_data = coalesce(staff.legacy_data, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'import_source', v_source,
          'import_source_file', nullif(btrim(p_source_file), ''),
          'importedFrom', v_source,
          'sourceFile', nullif(btrim(p_source_file), ''),
          'importedAt', now()
        )
      ),
      updated_at = now()
  where staff.id = v_staff_id;

  if not found then
    raise exception 'No se pudo confirmar la alta importada';
  end if;

  return query select v_staff_id, true;
end;
$function$;

revoke all on function public.import_geovictoria_staff_profile(
  uuid, text, text, text, text, date, text
) from public, anon;
grant execute on function public.import_geovictoria_staff_profile(
  uuid, text, text, text, text, date, text
) to authenticated;

-- The old post-create mutation is intentionally no longer a client contract:
-- leaving it executable would preserve the non-atomic failure mode above.
revoke all on function public.mark_staff_import_state(uuid[], boolean, text, text)
  from public, anon, authenticated;
