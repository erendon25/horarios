-- `staff_profiles.status` is an HR/import lifecycle flag, not proof that an
-- employment episode ended.  Keep GeoVictoria retries on the same identity
-- unless a cessation or trainee end date is already effective.  This matches
-- private.current_staff_profile_id() and the account relink rules.
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

  -- Only an effective cessation or trainee end makes an episode historical.
  -- `status = inactive` alone deliberately remains a stable retry target.
  -- With no current episode, a rehire receives a new staff row.  The advisory
  -- lock above makes the first imported pending row the stable retry target.

  if v_normalized_email is not null
     and exists (
       select 1
       from public.staff_profiles staff
       where nullif(lower(btrim(staff.email)), '') = v_normalized_email
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
