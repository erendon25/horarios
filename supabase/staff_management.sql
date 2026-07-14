-- Administración de colaboradores y vínculo seguro con Supabase Auth.

create or replace function public.save_staff_profile(
  p_staff_id uuid default null,
  p_store_id uuid default null,
  p_first_name text default null,
  p_last_name text default null,
  p_email text default null,
  p_dni text default null,
  p_gender text default null,
  p_birth_date date default null,
  p_modality text default 'Full-Time',
  p_position text default 'COLABORADOR',
  p_status public.record_status default 'pending',
  p_join_date date default null,
  p_sanitary_card_expiry date default null,
  p_sanitary_card_unlock boolean default false,
  p_is_trainee boolean default false,
  p_training_end_date date default null,
  p_modality_change_date date default null,
  p_next_modality text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_user_id uuid;
begin
  if p_store_id is null then raise exception 'La tienda es obligatoria'; end if;
  if nullif(trim(p_first_name), '') is null or nullif(trim(p_last_name), '') is null then
    raise exception 'Nombre y apellido son obligatorios';
  end if;
  if (p_modality_change_date is null) <> (p_next_modality is null) then
    raise exception 'La fecha y la nueva modalidad deben registrarse juntas';
  end if;

  if p_staff_id is null then
    insert into public.staff_profiles (
      store_id, first_name, last_name, email, dni, gender, birth_date, modality,
      position, status, join_date, sanitary_card_expiry, sanitary_card_unlock,
      is_trainee, training_end_date, modality_change_date, next_modality
    ) values (
      p_store_id, trim(p_first_name), trim(p_last_name), nullif(lower(trim(p_email)), ''),
      nullif(trim(p_dni), ''), nullif(trim(p_gender), ''), p_birth_date,
      nullif(trim(p_modality), ''), trim(p_position), p_status, p_join_date,
      p_sanitary_card_expiry, p_sanitary_card_unlock, p_is_trainee,
      case when p_is_trainee then p_training_end_date else null end,
      p_modality_change_date, p_next_modality
    ) returning id, user_id into v_staff_id, v_user_id;
  else
    update public.staff_profiles
    set
      store_id = p_store_id,
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      email = nullif(lower(trim(p_email)), ''),
      dni = nullif(trim(p_dni), ''),
      gender = nullif(trim(p_gender), ''),
      birth_date = p_birth_date,
      modality = nullif(trim(p_modality), ''),
      position = trim(p_position),
      status = p_status,
      join_date = p_join_date,
      sanitary_card_expiry = p_sanitary_card_expiry,
      sanitary_card_unlock = p_sanitary_card_unlock,
      is_trainee = p_is_trainee,
      cessation_date = case when p_is_trainee then null else cessation_date end,
      training_end_date = case when p_is_trainee then p_training_end_date else null end,
      modality_change_date = p_modality_change_date,
      next_modality = p_next_modality,
      updated_at = now()
    where id = p_staff_id
    returning id, user_id into v_staff_id, v_user_id;

    if not found then raise exception 'Colaborador no encontrado o sin permisos'; end if;
  end if;

  if v_user_id is not null then
    update public.user_profiles
    set
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      email = nullif(lower(trim(p_email)), ''),
      store_id = p_store_id,
      staff_profile_id = v_staff_id,
      status = p_status,
      role = case
        when role in ('admin', 'superadmin') then role
        when upper(trim(p_position)) = 'ENTRENADOR' then 'trainer'::public.app_role
        else 'collaborator'::public.app_role
      end,
      updated_at = now()
    where id = v_user_id;

    if not found then raise exception 'La cuenta vinculada no tiene un perfil de usuario válido'; end if;
  end if;

  return v_staff_id;
end;
$$;

revoke all on function public.save_staff_profile(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) from public, anon;
grant execute on function public.save_staff_profile(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) to authenticated;

create or replace function public.link_invited_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.app_role
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff public.staff_profiles%rowtype;
begin
  if p_role not in ('trainer', 'collaborator') then
    raise exception 'Rol de invitación no permitido';
  end if;

  update public.staff_profiles
  set
    user_id = p_user_id,
    email = lower(trim(p_email)),
    status = 'active',
    linked_at = now(),
    updated_at = now()
  where id = p_staff_id and user_id is null
  returning * into v_staff;

  if not found then raise exception 'El colaborador ya está vinculado o no existe'; end if;

  insert into public.user_profiles (
    id, email, first_name, last_name, role, status, store_id,
    staff_profile_id, registration_pending, updated_at
  ) values (
    p_user_id, lower(trim(p_email)), v_staff.first_name, v_staff.last_name,
    p_role, 'active', v_staff.store_id, v_staff.id, false, now()
  )
  on conflict (id) do update set
    email = excluded.email,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    role = excluded.role,
    status = excluded.status,
    store_id = excluded.store_id,
    staff_profile_id = excluded.staff_profile_id,
    registration_pending = false,
    updated_at = now();
end;
$$;

revoke all on function public.link_invited_staff_account(uuid, uuid, text, public.app_role)
  from public, anon, authenticated;
grant execute on function public.link_invited_staff_account(uuid, uuid, text, public.app_role)
  to service_role;
