create or replace function public.update_own_staff_profile(
  p_birth_date date default null,
  p_position_abilities jsonb default null,
  p_pending_holidays jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_lock jsonb;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if (p_position_abilities is not null and jsonb_typeof(p_position_abilities) <> 'array')
     or (p_pending_holidays is not null and jsonb_typeof(p_pending_holidays) <> 'array') then
    raise exception 'Los datos del perfil deben ser listas';
  end if;

  select store_id into v_store_id
  from public.staff_profiles
  where user_id = (select auth.uid()) and status = 'active';

  if p_pending_holidays is not null and v_store_id is not null then
    select value into v_lock
    from public.store_configs
    where store_id = v_store_id and config_key = 'schedule_lock';

    if coalesce((v_lock->>'restrictionsEnabled')::boolean, false)
       and coalesce(v_lock->>'reenableDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
       and v_today <= (v_lock->>'reenableDate')::date then
      raise exception 'Cambios temporalmente bloqueados';
    end if;
  end if;

  update public.staff_profiles
  set birth_date = coalesce(p_birth_date, birth_date),
      position_abilities = coalesce(p_position_abilities, position_abilities),
      pending_holidays = coalesce(p_pending_holidays, pending_holidays),
      updated_at = now()
  where user_id = (select auth.uid()) and status = 'active';

  return found;
end;
$$;

revoke all on function public.update_own_staff_profile(date, jsonb, jsonb) from public, anon;
grant execute on function public.update_own_staff_profile(date, jsonb, jsonb) to authenticated;
