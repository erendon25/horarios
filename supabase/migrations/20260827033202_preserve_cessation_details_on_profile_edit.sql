-- Editing a staff profile must not replace the detailed cessation report with
-- generic defaults. The existing trigger safely keeps those fields when only
-- identity or the cessation date changes, so this wrapper changes the date
-- directly and only when it is actually different.
create or replace function public.save_staff_profile_and_cessation(
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
  p_next_modality text default null,
  p_cessation_date date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_staff_id uuid;
  v_previous_cessation_date date;
  v_target_cessation_date date := case
    when coalesce(p_is_trainee, false) then null
    else p_cessation_date
  end;
begin
  if p_staff_id is not null then
    select sp.cessation_date
    into v_previous_cessation_date
    from public.staff_profiles sp
    where sp.id = p_staff_id
    for update;

    if not found then
      raise exception 'Colaborador no encontrado o sin permisos';
    end if;
  end if;

  v_staff_id := public.save_staff_profile(
    p_staff_id,
    p_store_id,
    p_first_name,
    p_last_name,
    p_email,
    p_dni,
    p_gender,
    p_birth_date,
    p_modality,
    p_position,
    p_status,
    p_join_date,
    p_sanitary_card_expiry,
    p_sanitary_card_unlock,
    p_is_trainee,
    p_training_end_date,
    p_modality_change_date,
    p_next_modality
  );

  if (p_staff_id is null and v_target_cessation_date is not null)
     or (p_staff_id is not null and v_previous_cessation_date is distinct from v_target_cessation_date) then
    update public.staff_profiles sp
    set cessation_date = v_target_cessation_date,
        updated_at = now()
    where sp.id = v_staff_id;

    if not found then
      raise exception 'Colaborador no encontrado o sin permisos';
    end if;
  end if;

  return v_staff_id;
end;
$function$;

revoke all on function public.save_staff_profile_and_cessation(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text, date
) from public, anon;
grant execute on function public.save_staff_profile_and_cessation(
  uuid, uuid, text, text, text, text, text, date, text, text,
  public.record_status, date, date, boolean, boolean, date, date, text, date
) to authenticated;
