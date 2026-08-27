-- Signed/completed evaluations are evidence, not editable working documents.
-- Corrections require a separate provenance-aware workflow instead of an
-- in-place update that silently changes signatures or answers.
create or replace function private.protect_completed_training_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.status = 'completed' then
    raise exception using
      errcode = '23514',
      message = case
        when tg_op = 'DELETE'
          then 'Una evaluación completada no se elimina; registra una corrección auditada'
        else 'Una evaluación completada y firmada es inmutable; registra una nueva evaluación'
      end;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_completed_training_evaluation()
  from public, anon, authenticated;

-- Once a training end date is effective, the episode cannot be reopened or
-- rewritten by the generic staff editor.  A future date may still be corrected
-- before it takes effect.
create or replace function private.protect_effective_training_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.is_trainee
     and old.training_end_date is not null
     and old.training_end_date <= (now() at time zone 'America/Lima')::date
     and (
       new.is_trainee,
       new.training_end_date,
       new.join_date
     ) is distinct from (
       old.is_trainee,
       old.training_end_date,
       old.join_date
     ) then
    raise exception using
      errcode = '23514',
      message = 'Un fin de entrenamiento efectivo es inmutable; registra una nueva ficha para otro episodio';
  end if;

  return new;
end;
$function$;

revoke all on function private.protect_effective_training_history()
  from public, anon, authenticated;

drop trigger if exists staff_profiles_protect_effective_training
  on public.staff_profiles;
create trigger staff_profiles_protect_effective_training
before update of is_trainee, training_end_date, join_date
on public.staff_profiles
for each row execute function private.protect_effective_training_history();

-- Avoid duplicate audit rows and make the immutable state explicit at the RPC
-- boundary as well as in the trigger.
create or replace function public.finish_staff_training(
  p_staff_id uuid,
  p_training_end_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff public.staff_profiles%rowtype;
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if (select auth.uid()) is null then
    raise exception 'Sesión no válida';
  end if;
  if p_training_end_date is null or p_training_end_date > v_today + 1 then
    raise exception 'Fecha de fin de entrenamiento inválida';
  end if;

  select * into v_staff
  from public.staff_profiles staff
  where staff.id = p_staff_id
  for update;

  if not found or not v_staff.is_trainee then
    raise exception 'Trainee no encontrado';
  end if;
  if v_staff.join_date is not null and p_training_end_date < v_staff.join_date then
    raise exception 'El fin de entrenamiento no puede ser anterior al ingreso';
  end if;
  if not (
    v_role = 'superadmin'
    or (v_role = 'admin' and v_store_id = v_staff.store_id)
  ) then
    raise exception 'No tienes permiso para finalizar este entrenamiento';
  end if;

  if v_staff.training_end_date = p_training_end_date then
    return;
  end if;
  if v_staff.training_end_date is not null
     and v_staff.training_end_date <= v_today then
    raise exception using
      errcode = '23514',
      message = 'Un fin de entrenamiento efectivo es inmutable; registra una nueva ficha para otro episodio';
  end if;

  update public.staff_profiles
  set training_end_date = p_training_end_date,
      updated_at = now()
  where id = v_staff.id;

  insert into public.audit_log (
    actor_id, store_id, table_name, record_id, action, old_data, new_data
  ) values (
    (select auth.uid()),
    v_staff.store_id,
    'staff_profiles',
    v_staff.id::text,
    'UPDATE',
    jsonb_build_object('training_end_date', v_staff.training_end_date),
    jsonb_build_object('training_end_date', p_training_end_date, 'operation', 'finish_training')
  );
end;
$function$;

revoke all on function public.finish_staff_training(uuid, date)
  from public, anon;
grant execute on function public.finish_staff_training(uuid, date)
  to authenticated;

-- A trainee remains current through the recorded final day and loses all
-- staff-role authorization from the following day, exactly like a cessation.
create or replace function private.current_staff_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select profile.staff_profile_id
  from public.user_profiles profile
  join public.staff_profiles staff
    on staff.id = profile.staff_profile_id
   and staff.user_id = profile.id
   and staff.store_id = profile.store_id
  join public.stores store
    on store.id = staff.store_id
   and store.is_active
  where profile.id = (select auth.uid())
    and profile.status = 'active'
    and not profile.registration_pending
    and (
      staff.cessation_date is null
      or staff.cessation_date >= (now() at time zone 'America/Lima')::date
    )
    and (
      not staff.is_trainee
      or staff.training_end_date is null
      or staff.training_end_date >= (now() at time zone 'America/Lima')::date
    )
  limit 1
$function$;

revoke all on function private.current_staff_profile_id()
  from public, anon;
grant execute on function private.current_staff_profile_id()
  to authenticated;

-- No service path may attach an Auth account to an already-finished trainee.
create or replace function private.enforce_linked_staff_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth_email text;
begin
  if new.user_id is null then
    return new;
  end if;

  select nullif(lower(btrim(account.email)), '')
  into v_auth_email
  from auth.users account
  where account.id = new.user_id;

  if not found then
    raise exception using errcode = '23503', message = 'La cuenta Auth vinculada no existe';
  end if;

  if nullif(lower(btrim(new.email)), '') is distinct from v_auth_email then
    raise exception using
      errcode = '23514',
      message = 'El correo vinculado debe actualizarse junto con Supabase Auth';
  end if;

  if not exists (
    select 1
    from public.stores store
    where store.id = new.store_id
      and store.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'Una cuenta vinculada requiere una tienda activa';
  end if;

  if new.cessation_date is not null
     and new.cessation_date < (now() at time zone 'America/Lima')::date then
    raise exception using errcode = '23514', message = 'No se puede vincular una ficha con cese efectivo';
  end if;

  if new.is_trainee
     and new.training_end_date is not null
     and new.training_end_date < (now() at time zone 'America/Lima')::date then
    raise exception using errcode = '23514', message = 'No se puede vincular una ficha trainee ya finalizada';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_linked_staff_identity()
  from public, anon, authenticated;

-- Let a verified account move from a completed trainee episode to a new staff
-- profile.  The former implementation already handles effective cessations;
-- this checked wrapper atomically releases only a complete inverse link whose
-- trainee end is effective, then delegates all email/role/target checks.
do $migration$
begin
  if to_regprocedure(
    'private.link_existing_staff_account_internal(uuid,uuid,text,public.app_role)'
  ) is null then
    if to_regprocedure(
      'public.link_existing_staff_account(uuid,uuid,text,public.app_role)'
    ) is null then
      raise exception 'public.link_existing_staff_account is missing';
    end if;

    alter function public.link_existing_staff_account(uuid, uuid, text, public.app_role)
      rename to link_existing_staff_account_internal;
    alter function public.link_existing_staff_account_internal(uuid, uuid, text, public.app_role)
      set schema private;
  end if;
end;
$migration$;

revoke all on function private.link_existing_staff_account_internal(
  uuid, uuid, text, public.app_role
) from public, anon, authenticated;

create or replace function public.link_existing_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile public.user_profiles%rowtype;
  v_previous public.staff_profiles%rowtype;
  v_target public.staff_profiles%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  select * into v_target
  from public.staff_profiles staff
  where staff.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;
  if v_target.is_trainee
     and v_target.training_end_date is not null
     and v_target.training_end_date < v_today then
    raise exception 'El perfil trainee de destino ya finalizó';
  end if;

  select * into v_profile
  from public.user_profiles profile
  where profile.id = p_user_id
  for update;

  if found
     and v_profile.role in ('trainer', 'collaborator')
     and v_profile.staff_profile_id is not null
     and v_profile.staff_profile_id <> p_staff_id then
    select * into v_previous
    from public.staff_profiles staff
    where staff.id = v_profile.staff_profile_id
      and staff.user_id = p_user_id
    for update;

    if found
       and v_previous.is_trainee
       and v_previous.training_end_date is not null
       and v_previous.training_end_date < v_today then
      update public.staff_profiles staff
      set user_id = null,
          updated_at = now()
      where staff.id = v_previous.id
        and staff.user_id = p_user_id;

      update public.user_profiles profile
      set staff_profile_id = null,
          registration_pending = true,
          updated_at = now()
      where profile.id = p_user_id
        and profile.staff_profile_id = v_previous.id;
    end if;
  end if;

  return private.link_existing_staff_account_internal(
    p_staff_id,
    p_user_id,
    p_email,
    p_role
  );
end;
$function$;

revoke all on function public.link_existing_staff_account(
  uuid, uuid, text, public.app_role
) from public, anon, authenticated;
grant execute on function public.link_existing_staff_account(
  uuid, uuid, text, public.app_role
) to service_role;

-- Keep self-claim ambiguity checks from treating an expired trainee episode as
-- another available candidate.
create or replace function public.claim_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_dni text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff public.staff_profiles%rowtype;
  v_role public.app_role;
  v_normalized_dni text := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
  v_normalized_email text := nullif(lower(btrim(p_email)), '');
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if p_user_id is null or v_normalized_email is null then
    raise exception 'La identidad autenticada es obligatoria';
  end if;

  perform 1
  from auth.users account
  where account.id = p_user_id
    and nullif(lower(btrim(account.email)), '') = v_normalized_email
    and account.email_confirmed_at is not null;
  if not found then raise exception 'El correo autenticado no está verificado'; end if;

  if length(v_normalized_dni) < 6 or length(v_normalized_dni) > 15 then
    raise exception 'DNI inválido';
  end if;

  select * into v_staff
  from public.staff_profiles staff
  where staff.id = p_staff_id
  for update;
  if not found then raise exception 'Colaborador no encontrado'; end if;

  if v_staff.user_id is null and v_staff.status <> 'pending' then
    raise exception 'El colaborador ya no está disponible';
  end if;
  if v_staff.user_id is not null and v_staff.user_id <> p_user_id then
    raise exception 'El colaborador ya está vinculado';
  end if;
  if v_staff.cessation_date is not null and v_staff.cessation_date < v_today then
    raise exception 'El colaborador ya no está vigente';
  end if;
  if v_staff.is_trainee
     and v_staff.training_end_date is not null
     and v_staff.training_end_date < v_today then
    raise exception 'El trainee ya finalizó';
  end if;
  if regexp_replace(coalesce(v_staff.dni, ''), '[^0-9]', '', 'g') <> v_normalized_dni then
    raise exception 'El DNI no coincide';
  end if;
  if nullif(lower(btrim(v_staff.email)), '') is null
     or lower(btrim(v_staff.email)) <> v_normalized_email then
    raise exception 'El correo no coincide';
  end if;

  perform 1
  from public.staff_profiles other
  where other.id <> v_staff.id
    and other.store_id = v_staff.store_id
    and other.status = 'pending'
    and other.user_id is null
    and (other.cessation_date is null or other.cessation_date >= v_today)
    and (
      not other.is_trainee
      or other.training_end_date is null
      or other.training_end_date >= v_today
    )
    and regexp_replace(coalesce(other.dni, ''), '[^0-9]', '', 'g') = v_normalized_dni;
  if found then raise exception 'El DNI coincide con más de un colaborador disponible'; end if;

  v_role := case
    when upper(btrim(v_staff.position)) = 'ENTRENADOR'
      then 'trainer'::public.app_role
    else 'collaborator'::public.app_role
  end;

  return public.link_existing_staff_account(
    p_staff_id,
    p_user_id,
    v_normalized_email,
    v_role
  );
end;
$function$;

revoke all on function public.claim_staff_account(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_staff_account(uuid, uuid, text, text)
  to service_role;
