-- Identity and employment records must be changed only through the audited,
-- column-limited RPCs.  Row policies alone cannot prevent an administrator
-- from promoting a same-store account or disconnecting its inverse staff link.

-- save_staff_profile already performs explicit canonical role/store checks.
-- Make it the privileged write boundary before removing table writes.
alter function public.save_staff_profile(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) security definer;

-- This wrapper delegates authorization to save_staff_profile and then changes
-- only the synchronized cessation date inside the same transaction.
alter function public.save_staff_profile_and_cessation(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text, date
) security definer;

-- Preserve the detailed cessation implementation behind a checked wrapper.
do $migration$
begin
  if to_regprocedure(
    'private.save_staff_cessation_internal(uuid,date,text,text,text,text,numeric,numeric,text,numeric,numeric,numeric,numeric)'
  ) is null then
    if to_regprocedure(
      'public.save_staff_cessation(uuid,date,text,text,text,text,numeric,numeric,text,numeric,numeric,numeric,numeric)'
    ) is null then
      raise exception 'public.save_staff_cessation is missing';
    end if;

    alter function public.save_staff_cessation(
      uuid, date, text, text, text, text, numeric, numeric, text,
      numeric, numeric, numeric, numeric
    ) rename to save_staff_cessation_internal;

    alter function public.save_staff_cessation_internal(
      uuid, date, text, text, text, text, numeric, numeric, text,
      numeric, numeric, numeric, numeric
    ) set schema private;
  end if;
end;
$migration$;

revoke all on function private.save_staff_cessation_internal(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) from public, anon, authenticated;

create or replace function public.save_staff_cessation(
  p_staff_id uuid,
  p_cessation_date date,
  p_performance text default null,
  p_cessation_reason text default null,
  p_real_reason text default null,
  p_store_comment text default null,
  p_medical_leave_days numeric default null,
  p_absences numeric default null,
  p_tardiness text default null,
  p_night_hours numeric default null,
  p_extra_hours numeric default null,
  p_holidays numeric default null,
  p_discounts numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
  v_staff_store_id uuid;
begin
  select staff.store_id
  into v_staff_store_id
  from public.staff_profiles staff
  where staff.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado o sin permisos';
  end if;

  if v_role not in ('admin', 'superadmin')
     or (v_role = 'admin' and v_store_id is distinct from v_staff_store_id) then
    raise exception using
      errcode = '42501',
      message = 'Colaborador no encontrado o sin permisos';
  end if;

  perform private.save_staff_cessation_internal(
    p_staff_id,
    p_cessation_date,
    p_performance,
    p_cessation_reason,
    p_real_reason,
    p_store_comment,
    p_medical_leave_days,
    p_absences,
    p_tardiness,
    p_night_hours,
    p_extra_hours,
    p_holidays,
    p_discounts
  );
end;
$function$;

revoke all on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) to authenticated;

-- GeoVictoria imports need one narrow post-create mutation.  It cannot alter
-- identity, role, store, status, dates or any other employment attribute.
create or replace function public.mark_staff_import_state(
  p_staff_ids uuid[],
  p_needs_completion boolean,
  p_source text default null,
  p_source_file text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
  v_expected integer;
  v_updated integer;
  v_metadata jsonb;
begin
  if v_role not in ('admin', 'superadmin') then
    raise exception using errcode = '42501', message = 'No tienes permiso para administrar colaboradores';
  end if;

  if p_staff_ids is null
     or cardinality(p_staff_ids) = 0
     or cardinality(p_staff_ids) > 500
     or array_position(p_staff_ids, null) is not null then
    raise exception 'Lista de colaboradores no válida';
  end if;

  select count(distinct id)::integer
  into v_expected
  from unnest(p_staff_ids) as requested(id);

  if v_expected <> cardinality(p_staff_ids) then
    raise exception 'No se puede repetir un colaborador';
  end if;

  if length(coalesce(p_source, '')) > 100
     or length(coalesce(p_source_file, '')) > 500 then
    raise exception 'Metadatos de importación no válidos';
  end if;

  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'importedFrom', nullif(btrim(p_source), ''),
    'sourceFile', nullif(btrim(p_source_file), ''),
    'importedAt', now()
  ));

  update public.staff_profiles staff
  set needs_completion = p_needs_completion,
      legacy_data = coalesce(staff.legacy_data, '{}'::jsonb) || v_metadata,
      updated_at = now()
  where staff.id = any(p_staff_ids)
    and (
      v_role = 'superadmin'
      or staff.store_id = v_store_id
    );

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception using
      errcode = '42501',
      message = 'Uno o más colaboradores no existen o pertenecen a otra tienda';
  end if;

  return v_updated;
end;
$function$;

revoke all on function public.mark_staff_import_state(uuid[], boolean, text, text)
  from public, anon;
grant execute on function public.mark_staff_import_state(uuid[], boolean, text, text)
  to authenticated;

revoke update on public.user_profiles from authenticated;
revoke insert, update on public.staff_profiles from authenticated;

drop policy if exists user_profiles_admin_update on public.user_profiles;
drop policy if exists staff_profiles_admin_write on public.staff_profiles;
