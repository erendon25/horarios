-- Prevent self-registration from exposing or claiming staff records that do not
-- already carry the authenticated account's verified email address.
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

  if not found then
    raise exception 'El correo autenticado no está verificado';
  end if;

  if length(v_normalized_dni) < 6 or length(v_normalized_dni) > 15 then
    raise exception 'DNI inválido';
  end if;

  select *
  into v_staff
  from public.staff_profiles sp
  where sp.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  if v_staff.user_id is null and v_staff.status <> 'pending' then
    raise exception 'El colaborador ya no está disponible';
  end if;

  if v_staff.user_id is not null and v_staff.user_id <> p_user_id then
    raise exception 'El colaborador ya está vinculado';
  end if;

  if v_staff.cessation_date is not null and v_staff.cessation_date < v_today then
    raise exception 'El colaborador ya no está vigente';
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
    and (
      other.cessation_date is null
      or other.cessation_date >= v_today
    )
    and regexp_replace(coalesce(other.dni, ''), '[^0-9]', '', 'g') = v_normalized_dni;

  if found then
    raise exception 'El DNI coincide con más de un colaborador disponible';
  end if;

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
