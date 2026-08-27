-- PL/pgSQL treats a NULL IF condition as false. Several privileged routines
-- correctly resolved inactive/unlinked accounts to a NULL canonical role but
-- then used `role NOT IN (...)`, which also evaluates to NULL. Put a strict,
-- non-null authorization boundary in front of every affected implementation.

do $migration$
begin
  if to_regprocedure(
    'private.save_staff_profile_internal(uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text)'
  ) is null then
    if to_regprocedure(
      'public.save_staff_profile(uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text)'
    ) is null then
      raise exception 'public.save_staff_profile is missing';
    end if;

    alter function public.save_staff_profile(
      uuid, uuid, text, text, text, text, text, date, text, text,
      public.record_status, date, date, boolean, boolean, date, date, text
    ) rename to save_staff_profile_internal;
    alter function public.save_staff_profile_internal(
      uuid, uuid, text, text, text, text, text, date, text, text,
      public.record_status, date, date, boolean, boolean, date, date, text
    ) set schema private;
  end if;
end;
$migration$;

revoke all on function private.save_staff_profile_internal(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) from public, anon, authenticated;

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
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
begin
  if (select auth.uid()) is null
     or v_role is null
     or v_role not in ('admin', 'superadmin') then
    raise exception using
      errcode = '42501',
      message = 'No tienes permiso para administrar colaboradores';
  end if;

  return private.save_staff_profile_internal(
    p_staff_id, p_store_id, p_first_name, p_last_name, p_email, p_dni,
    p_gender, p_birth_date, p_modality, p_position, p_status, p_join_date,
    p_sanitary_card_expiry, p_sanitary_card_unlock, p_is_trainee,
    p_training_end_date, p_modality_change_date, p_next_modality
  );
end;
$function$;

revoke all on function public.save_staff_profile(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) from public, anon;
grant execute on function public.save_staff_profile(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text
) to authenticated;

do $migration$
begin
  if to_regprocedure('private.replace_staff_skills_internal(uuid,text[])') is null then
    if to_regprocedure('public.replace_staff_skills(uuid,text[])') is null then
      raise exception 'public.replace_staff_skills is missing';
    end if;
    alter function public.replace_staff_skills(uuid, text[])
      rename to replace_staff_skills_internal;
    alter function public.replace_staff_skills_internal(uuid, text[])
      set schema private;
  end if;
end;
$migration$;

revoke all on function private.replace_staff_skills_internal(uuid, text[])
  from public, anon, authenticated;

create or replace function public.replace_staff_skills(
  p_staff_id uuid,
  p_skill_codes text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or private.current_user_role() is null then
    raise exception using errcode = '42501', message = 'Sesión sin autorización canónica';
  end if;

  perform private.replace_staff_skills_internal(p_staff_id, p_skill_codes);
end;
$function$;

revoke all on function public.replace_staff_skills(uuid, text[])
  from public, anon;
grant execute on function public.replace_staff_skills(uuid, text[])
  to authenticated;

do $migration$
begin
  if to_regprocedure('private.finish_staff_training_internal(uuid,date)') is null then
    if to_regprocedure('public.finish_staff_training(uuid,date)') is null then
      raise exception 'public.finish_staff_training is missing';
    end if;
    alter function public.finish_staff_training(uuid, date)
      rename to finish_staff_training_internal;
    alter function public.finish_staff_training_internal(uuid, date)
      set schema private;
  end if;
end;
$migration$;

revoke all on function private.finish_staff_training_internal(uuid, date)
  from public, anon, authenticated;

create or replace function public.finish_staff_training(
  p_staff_id uuid,
  p_training_end_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null
     or private.current_user_role() is null then
    raise exception using errcode = '42501', message = 'Sesión sin autorización canónica';
  end if;

  perform private.finish_staff_training_internal(p_staff_id, p_training_end_date);
end;
$function$;

revoke all on function public.finish_staff_training(uuid, date)
  from public, anon;
grant execute on function public.finish_staff_training(uuid, date)
  to authenticated;

create or replace function public.save_staff_cessation(
  p_staff_id uuid,
  p_cessation_date date,
  p_performance text default null,
  p_cessation_reason text default null,
  p_real_reason text default null,
  p_store_comment text default null,
  p_medical_leave_days numeric default null,
  p_absences numeric default null,
  p_tardiness text default null,
  p_night_hours numeric default null,
  p_extra_hours numeric default null,
  p_holidays numeric default null,
  p_discounts numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
  v_staff_store_id uuid;
begin
  if (select auth.uid()) is null
     or v_role is null
     or v_role not in ('admin', 'superadmin') then
    raise exception using errcode = '42501', message = 'Colaborador no encontrado o sin permisos';
  end if;

  select staff.store_id
  into v_staff_store_id
  from public.staff_profiles staff
  where staff.id = p_staff_id
  for update;

  if not found
     or (v_role = 'admin' and v_store_id is distinct from v_staff_store_id) then
    raise exception using errcode = '42501', message = 'Colaborador no encontrado o sin permisos';
  end if;

  perform private.save_staff_cessation_internal(
    p_staff_id, p_cessation_date, p_performance, p_cessation_reason,
    p_real_reason, p_store_comment, p_medical_leave_days, p_absences,
    p_tardiness, p_night_hours, p_extra_hours, p_holidays, p_discounts
  );
end;
$function$;

revoke all on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) to authenticated;

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
  if (select auth.uid()) is null
     or v_role is null
     or v_role not in ('admin', 'superadmin')
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
