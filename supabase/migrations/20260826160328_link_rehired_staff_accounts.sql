-- Reutiliza una identidad de Supabase Auth cuando una persona reingresa.
-- El perfil laboral cesado se conserva intacto como historial; solo se mueve
-- el vínculo de acceso al nuevo perfil vigente.

create or replace function public.link_existing_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_staff public.staff_profiles%rowtype;
  v_previous_staff_id uuid;
  v_existing_role public.app_role;
begin
  if p_role not in ('trainer', 'collaborator') then
    raise exception 'Rol de reingreso no permitido';
  end if;

  if nullif(lower(trim(p_email)), '') is null then
    raise exception 'El correo es obligatorio';
  end if;

  select *
  into v_staff
  from public.staff_profiles
  where id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  if nullif(trim(v_staff.email), '') is not null
     and lower(trim(v_staff.email)) <> lower(trim(p_email)) then
    raise exception 'El correo no coincide con el perfil de reingreso';
  end if;

  if v_staff.status = 'inactive'
     or (v_staff.cessation_date is not null and v_staff.cessation_date < current_date) then
    raise exception 'El perfil de reingreso no está vigente';
  end if;

  if v_staff.user_id is not null and v_staff.user_id <> p_user_id then
    raise exception 'El perfil de reingreso ya está vinculado a otra cuenta';
  end if;

  select role
  into v_existing_role
  from public.user_profiles
  where id = p_user_id;

  if v_existing_role = 'superadmin' then
    raise exception 'Una cuenta superadmin no puede reasignarse como colaborador';
  end if;

  select id
  into v_previous_staff_id
  from public.staff_profiles
  where user_id = p_user_id and id <> p_staff_id
  for update;

  update public.staff_profiles
  set user_id = null, updated_at = now()
  where user_id = p_user_id and id <> p_staff_id;

  update public.staff_profiles
  set
    user_id = p_user_id,
    email = lower(trim(p_email)),
    status = 'active',
    linked_at = now(),
    updated_at = now()
  where id = p_staff_id;

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

  return v_previous_staff_id;
end;
$$;

revoke all on function public.link_existing_staff_account(
  uuid, uuid, text, public.app_role
) from public, anon, authenticated;
grant execute on function public.link_existing_staff_account(
  uuid, uuid, text, public.app_role
) to service_role;
