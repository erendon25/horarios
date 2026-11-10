-- Recuperación del mismo vínculo: no reasigna identidades ni reactiva inactivos.
create or replace function public.recover_current_staff_access(p_user_id uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff public.staff_profiles%rowtype;
  v_profile public.user_profiles%rowtype;
  v_auth_email text;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  select * into v_profile from public.user_profiles where id = p_user_id for update;
  if not found or v_profile.role not in ('collaborator', 'trainer')
     or v_profile.staff_profile_id is null then return false; end if;
  select * into v_staff from public.staff_profiles where id = v_profile.staff_profile_id for update;
  if not found or v_staff.user_id is distinct from p_user_id
     or v_staff.store_id is distinct from v_profile.store_id then return false; end if;
  if v_profile.status not in ('active', 'pending') or v_staff.status not in ('active', 'pending') then
    raise exception 'inactive_access';
  end if;
  if (v_staff.cessation_date is not null and v_staff.cessation_date < v_today)
     or (v_staff.is_trainee and v_staff.training_end_date is not null and v_staff.training_end_date < v_today) then
    raise exception 'employment_ended';
  end if;
  perform 1 from public.stores where id = v_staff.store_id and is_active for share;
  if not found then raise exception 'inactive_store'; end if;
  select lower(btrim(email)) into v_auth_email from auth.users where id = p_user_id for share;
  if not found or nullif(lower(btrim(p_email)), '') is null
     or v_auth_email is distinct from lower(btrim(p_email))
     or lower(btrim(v_staff.email)) is distinct from v_auth_email
     or lower(btrim(v_profile.email)) is distinct from v_auth_email then
    raise exception 'identity_mismatch';
  end if;
  update public.staff_profiles set status = 'active', updated_at = now()
    where id = v_staff.id and status = 'pending';
  update public.user_profiles set status = 'active', registration_pending = false, updated_at = now()
    where id = p_user_id and (status = 'pending' or registration_pending);
  return true;
end;
$$;
revoke all on function public.recover_current_staff_access(uuid, text) from public, anon, authenticated;
grant execute on function public.recover_current_staff_access(uuid, text) to service_role;
