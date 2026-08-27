-- Preserve omitted report fields exactly, including legacy NULL values. A new
-- date-only cession receives the former BUENO default, while an existing report
-- is never normalized or overwritten implicitly.
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
security invoker
set search_path = ''
as $function$
declare
  v_had_cessation boolean;
begin
  select exists (
    select 1
    from public.cessations c
    where c.staff_id = p_staff_id
      and not c.is_modality_change
  ) into v_had_cessation;

  update public.staff_profiles
  set cessation_date = p_cessation_date,
      updated_at = now()
  where id = p_staff_id;

  if not found then
    raise exception 'Colaborador no encontrado o sin permisos';
  end if;

  if p_cessation_date is not null then
    update public.cessations c
    set performance = case
          when p_performance is null and not v_had_cessation then coalesce(c.performance, 'BUENO')
          when p_performance is null then c.performance
          else nullif(btrim(p_performance), '')
        end,
        cessation_reason = case when p_cessation_reason is null then c.cessation_reason else nullif(btrim(p_cessation_reason), '') end,
        real_reason = case when p_real_reason is null then c.real_reason else nullif(btrim(p_real_reason), '') end,
        store_comment = case when p_store_comment is null then c.store_comment else nullif(btrim(p_store_comment), '') end,
        medical_leave_days = case when p_medical_leave_days is null then c.medical_leave_days else greatest(p_medical_leave_days, 0) end,
        absences = case when p_absences is null then c.absences else greatest(p_absences, 0) end,
        tardiness = case when p_tardiness is null then c.tardiness else nullif(btrim(p_tardiness), '') end,
        night_hours = case when p_night_hours is null then c.night_hours else greatest(p_night_hours, 0) end,
        extra_hours = case when p_extra_hours is null then c.extra_hours else greatest(p_extra_hours, 0) end,
        holidays = case when p_holidays is null then c.holidays else greatest(p_holidays, 0) end,
        discounts = case when p_discounts is null then c.discounts else greatest(p_discounts, 0) end,
        updated_at = now()
    where c.staff_id = p_staff_id
      and not c.is_modality_change;
  end if;
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

-- Effective employment episodes are immutable. Rehires receive a new staff
-- profile and reuse the verified account through the existing rehire flow.
create or replace function private.protect_effective_cessation_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if old.cessation_date is not null
     and old.cessation_date < (now() at time zone 'America/Lima')::date
     and new.cessation_date is null then
    raise exception using
      errcode = '23514',
      message = 'Un cese efectivo no se elimina; registra una nueva ficha para el reingreso';
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_effective_cessation_history()
  from public, anon, authenticated;

drop trigger if exists staff_profiles_protect_effective_cessation on public.staff_profiles;
create trigger staff_profiles_protect_effective_cessation
before update of cessation_date on public.staff_profiles
for each row execute function private.protect_effective_cessation_history();

create or replace function private.protect_effective_cessation_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not old.is_modality_change
     and exists (
       select 1
       from public.staff_profiles sp
       where sp.id = old.staff_id
         and sp.cessation_date is not null
         and sp.cessation_date < (now() at time zone 'America/Lima')::date
     ) then
    raise exception using
      errcode = '23514',
      message = 'El informe de un cese efectivo forma parte del historial laboral';
  end if;
  return old;
end;
$function$;

revoke all on function private.protect_effective_cessation_delete()
  from public, anon, authenticated;

drop trigger if exists cessations_protect_effective_history on public.cessations;
create trigger cessations_protect_effective_history
before delete on public.cessations
for each row execute function private.protect_effective_cessation_delete();
