-- Keep the large atomic replacement routine private and place a canonical,
-- active-store authorization boundary in front of it.  The original routine
-- looked directly at user_profiles, so an otherwise-active administrator of a
-- disabled store could still call it with a valid JWT.
do $migration$
begin
  if to_regprocedure('private.replace_weekly_schedules_internal(date,jsonb)') is null then
    if to_regprocedure('private.replace_weekly_schedules(date,jsonb)') is null then
      raise exception 'private.replace_weekly_schedules(date,jsonb) is missing';
    end if;

    alter function private.replace_weekly_schedules(date, jsonb)
      rename to replace_weekly_schedules_internal;
  end if;
end;
$migration$;

revoke all on function private.replace_weekly_schedules_internal(date, jsonb)
  from public, anon, authenticated;

create or replace function private.replace_weekly_schedules(
  p_week_start date,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
begin
  if v_role not in ('admin', 'superadmin')
     or (v_role = 'admin' and v_store_id is null) then
    raise exception using
      errcode = '42501',
      message = 'Usuario sin permiso para administrar horarios';
  end if;

  return private.replace_weekly_schedules_internal(p_week_start, p_changes);
end;
$function$;

revoke all on function private.replace_weekly_schedules(date, jsonb)
  from public, anon;
grant execute on function private.replace_weekly_schedules(date, jsonb)
  to authenticated;

-- Preserve the public RPC contract while ensuring it resolves the checked
-- wrapper created above.
create or replace function public.save_weekly_schedules(
  p_week_start date,
  p_changes jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select private.replace_weekly_schedules(p_week_start, p_changes)
$function$;

revoke all on function public.save_weekly_schedules(date, jsonb)
  from public, anon;
grant execute on function public.save_weekly_schedules(date, jsonb)
  to authenticated;
