-- Preserve both self-service invariants at once:
-- 1. skills remain controlled by evaluations/authorized managers;
-- 2. pending holiday changes respect the active store schedule lock.

create or replace function private.update_own_staff_profile(
  p_birth_date date default null::date,
  p_position_abilities jsonb default null::jsonb,
  p_pending_holidays jsonb default null::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff_id uuid := private.current_staff_profile_id();
  v_store_id uuid;
begin
  if v_staff_id is null then
    raise exception 'La cuenta no tiene un colaborador vigente vinculado';
  end if;

  if p_position_abilities is not null then
    raise exception 'Las habilidades solo pueden cambiarse mediante una evaluación o por un responsable autorizado';
  end if;

  if p_pending_holidays is not null
     and jsonb_typeof(p_pending_holidays) <> 'array' then
    raise exception 'Los feriados pendientes deben ser una lista';
  end if;

  if p_pending_holidays is not null
     and jsonb_array_length(p_pending_holidays) > 100 then
    raise exception 'Se permiten como máximo 100 feriados pendientes';
  end if;

  select sp.store_id
  into v_store_id
  from public.staff_profiles sp
  where sp.id = v_staff_id;

  if p_pending_holidays is not null
     and private.schedule_changes_locked(v_store_id) then
    raise exception 'Cambios temporalmente bloqueados';
  end if;

  update public.staff_profiles sp
  set birth_date = coalesce(p_birth_date, sp.birth_date),
      pending_holidays = coalesce(p_pending_holidays, sp.pending_holidays),
      updated_at = now()
  where sp.id = v_staff_id;

  return found;
end;
$function$;

revoke all on function private.update_own_staff_profile(date, jsonb, jsonb) from public, anon;
grant execute on function private.update_own_staff_profile(date, jsonb, jsonb) to authenticated, service_role;
