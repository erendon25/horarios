-- Hace efectivo el bloqueo administrativo también en el servidor para las
-- solicitudes de horario y los feriados pendientes. La UI sigue siendo una
-- ayuda visual, pero deja de ser la única barrera.

-- El panel del colaborador escucha este registro para aplicar el cambio sin
-- requerir una recarga. Se añade solo si la publicación existe y aún no lo
-- contiene, de modo que la migración sea repetible.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'store_configs'
     ) then
    alter publication supabase_realtime add table public.store_configs;
  end if;
end;
$$;

create or replace function private.schedule_changes_locked(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_configs sc
    where sc.store_id = p_store_id
      and sc.config_key = 'schedule_lock'
      and coalesce((sc.value->>'restrictionsEnabled')::boolean, false)
      and coalesce(sc.value->>'reenableDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and (now() at time zone 'America/Lima')::date <= (sc.value->>'reenableDate')::date
  );
$$;

revoke all on function private.schedule_changes_locked(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.schedule_changes_locked(uuid) to authenticated;

drop policy if exists schedule_requests_create on public.schedule_requests;
create policy schedule_requests_create on public.schedule_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and admin_comment is null
    and not private.schedule_changes_locked(store_id)
    and exists (
      select 1
      from public.staff_profiles sp
      where sp.id = schedule_requests.staff_id
        and sp.user_id = (select auth.uid())
        and sp.store_id = schedule_requests.store_id
    )
  );

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
begin
  if (p_position_abilities is not null and jsonb_typeof(p_position_abilities) <> 'array')
     or (p_pending_holidays is not null and jsonb_typeof(p_pending_holidays) <> 'array') then
    raise exception 'Los datos del perfil deben ser listas';
  end if;

  select store_id into v_store_id
  from public.staff_profiles
  where user_id = (select auth.uid()) and status = 'active';

  if p_pending_holidays is not null
     and v_store_id is not null
     and private.schedule_changes_locked(v_store_id) then
    raise exception 'Cambios temporalmente bloqueados';
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
