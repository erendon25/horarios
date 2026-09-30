-- Some environments received the hardened self-service RPC without the
-- schedule-lock helper from the earlier lock migration. Make the dependency
-- explicit so pending-holiday enforcement cannot fail open or at runtime.

create or replace function private.schedule_changes_locked(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.store_configs sc
    where sc.store_id = p_store_id
      and sc.config_key = 'schedule_lock'
      and coalesce((sc.value->>'restrictionsEnabled')::boolean, false)
      and coalesce(sc.value->>'reenableDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and (now() at time zone 'America/Lima')::date <= (sc.value->>'reenableDate')::date
  );
$function$;

revoke all on function private.schedule_changes_locked(uuid) from public, anon;
grant execute on function private.schedule_changes_locked(uuid) to authenticated, service_role;
