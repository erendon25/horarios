-- Administrative store access is valid only while that store remains active.
-- Superadmin stays the deliberate global exception; staff roles still depend
-- on the complete canonical staff link.
create or replace function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $function$
  select up.role
  from public.user_profiles up
  left join public.stores s on s.id = up.store_id
  where up.id = (select auth.uid())
    and up.status = 'active'
    and (
      up.role = 'superadmin'
      or (up.role = 'admin' and s.is_active)
      or (
        up.role in ('trainer', 'collaborator')
        and up.staff_profile_id = (select private.current_staff_profile_id())
      )
    )
  limit 1
$function$;

create or replace function private.current_user_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select up.store_id
  from public.user_profiles up
  left join public.stores s on s.id = up.store_id
  where up.id = (select auth.uid())
    and up.status = 'active'
    and (
      up.role = 'superadmin'
      or (up.role = 'admin' and s.is_active)
      or (
        up.role in ('trainer', 'collaborator')
        and up.staff_profile_id = (select private.current_staff_profile_id())
      )
    )
  limit 1
$function$;

revoke all on function private.current_user_role() from public, anon;
revoke all on function private.current_user_store_id() from public, anon;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_store_id() to authenticated;

create or replace function private.can_manage_sales(p_store_id uuid)
returns boolean
language sql
stable
security definer
parallel safe
set search_path = ''
as $function$
  select exists (
    select 1
    from public.user_profiles profile
    left join public.stores store on store.id = profile.store_id
    where profile.id = (select auth.uid())
      and profile.status = 'active'::public.record_status
      and (
        profile.role = 'superadmin'::public.app_role
        or (
          profile.role = 'admin'::public.app_role
          and profile.store_id = p_store_id
          and store.is_active
        )
      )
  )
$function$;

revoke all on function private.can_manage_sales(uuid) from public, anon;
grant execute on function private.can_manage_sales(uuid) to authenticated;

-- Once linked, the staff email is the Auth identity. It cannot drift through a
-- generic HR edit, and no account may stay operational in an inactive store.
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
    select 1 from public.stores store
    where store.id = new.store_id and store.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'Una cuenta vinculada requiere una tienda activa';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_linked_staff_identity()
  from public, anon, authenticated;

drop trigger if exists staff_profiles_enforce_linked_identity on public.staff_profiles;
create trigger staff_profiles_enforce_linked_identity
before insert or update of user_id, email, store_id on public.staff_profiles
for each row execute function private.enforce_linked_staff_identity();

-- An effective employment episode is immutable through generic application
-- flows. A correction requires an explicit audited maintenance procedure.
create or replace function private.protect_effective_cessation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.cessation_date is not null
     and old.cessation_date < (now() at time zone 'America/Lima')::date
     and new.cessation_date is distinct from old.cessation_date then
    raise exception using
      errcode = '23514',
      message = 'Un cese efectivo es inmutable; registra una nueva ficha para el reingreso';
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_effective_cessation_history()
  from public, anon, authenticated;

-- Completed evaluations may keep editable notes, but their accreditation
-- identity and score cannot change without a future provenance-aware reversal.
create or replace function private.protect_completed_training_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status = 'completed' then
      raise exception using
        errcode = '23514',
        message = 'Una evaluación completada no se elimina; registra una corrección auditada';
    end if;
    return old;
  end if;

  if old.status = 'completed'
     and (
       new.status,
       new.score,
       new.station_code,
       new.evaluation_date,
       new.staff_id,
       new.store_id
     ) is distinct from (
       old.status,
       old.score,
       old.station_code,
       old.evaluation_date,
       old.staff_id,
       old.store_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'Los datos acreditados de una evaluación completada son inmutables';
  end if;

  return new;
end;
$function$;

revoke all on function private.protect_completed_training_evaluation()
  from public, anon, authenticated;

drop trigger if exists training_evaluations_protect_completion on public.training_evaluations;
create trigger training_evaluations_protect_completion
before update or delete on public.training_evaluations
for each row execute function private.protect_completed_training_evaluation();

-- Training completion is not a regular cessation. Keep the trainee episode and
-- its end date together without violating staff_training_dates_check.
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
begin
  if (select auth.uid()) is null then
    raise exception 'Sesión no válida';
  end if;
  if p_training_end_date is null
     or p_training_end_date > (now() at time zone 'America/Lima')::date + 1 then
    raise exception 'Fecha de fin de entrenamiento inválida';
  end if;

  select * into v_staff
  from public.staff_profiles sp
  where sp.id = p_staff_id
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
