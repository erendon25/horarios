-- RR. HH.: una sola fuente de verdad para la fecha de cese.
-- La fecha vive en staff_profiles y el detalle del reporte en cessations.

-- Reconciliar la importación existente conservando el registro más completo.
with ranked as (
  select
    c.id,
    c.staff_id,
    row_number() over (
      partition by c.staff_id
      order by
        (c.cessation_date = sp.cessation_date) desc,
        ((c.cessation_reason is not null)::int + (c.real_reason is not null)::int +
         (c.store_comment is not null)::int) desc,
        c.updated_at desc,
        c.id desc
    ) as position
  from public.cessations c
  join public.staff_profiles sp on sp.id = c.staff_id
  where not c.is_modality_change
)
delete from public.cessations c
using ranked r, public.staff_profiles sp
where c.id = r.id
  and sp.id = r.staff_id
  and (sp.cessation_date is null or r.position > 1);

update public.cessations c
set
  store_id = sp.store_id,
  join_date = coalesce(c.join_date, sp.join_date),
  cessation_date = sp.cessation_date,
  cessation_reason = coalesce(c.cessation_reason, 'RENUNCIA VOLUNTARIA'),
  real_reason = coalesce(c.real_reason, 'MEJORA ECONÓMICA'),
  updated_at = now()
from public.staff_profiles sp
where c.staff_id = sp.id
  and not c.is_modality_change
  and sp.cessation_date is not null;

insert into public.cessations (
  staff_id, store_id, join_date, cessation_date, is_modality_change,
  cessation_reason, real_reason, legacy_data
)
select
  sp.id, sp.store_id, sp.join_date, sp.cessation_date, false,
  'RENUNCIA VOLUNTARIA', 'MEJORA ECONÓMICA',
  jsonb_strip_nulls(jsonb_build_object(
    'name', sp.first_name,
    'lastName', sp.last_name,
    'dni', sp.dni,
    'gender', sp.gender,
    'position', sp.position
  ))
from public.staff_profiles sp
where sp.cessation_date is not null
  and not exists (
    select 1 from public.cessations c
    where c.staff_id = sp.id and not c.is_modality_change
  );

-- Reparar registros ya existentes que fueron creados por el trigger sin identidad visible.
update public.cessations c
set
  legacy_data = coalesce(c.legacy_data, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'name', sp.first_name,
    'lastName', sp.last_name,
    'dni', sp.dni,
    'gender', sp.gender,
    'position', sp.position
  )),
  updated_at = now()
from public.staff_profiles sp
where c.staff_id = sp.id;

create unique index if not exists cessations_one_regular_per_staff_idx
  on public.cessations (staff_id)
  where not is_modality_change;

alter table public.cessations
  drop constraint if exists cessations_regular_reasons_check;
alter table public.cessations
  add constraint cessations_regular_reasons_check check (
    is_modality_change or (cessation_reason is not null and real_reason is not null)
  );

create or replace function public.sync_staff_cessation_record()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  identity_data jsonb;
begin
  identity_data := jsonb_strip_nulls(jsonb_build_object(
    'name', new.first_name,
    'lastName', new.last_name,
    'dni', new.dni,
    'gender', new.gender,
    'position', new.position
  ));

  if new.cessation_date is null then
    delete from public.cessations
    where staff_id = new.id and not is_modality_change;
  else
    insert into public.cessations (
      staff_id, store_id, join_date, cessation_date, is_modality_change,
      cessation_reason, real_reason, legacy_data
    ) values (
      new.id, new.store_id, new.join_date, new.cessation_date, false,
      'RENUNCIA VOLUNTARIA', 'MEJORA ECONÓMICA', identity_data
    )
    on conflict (staff_id) where not is_modality_change
    do update set
      store_id = excluded.store_id,
      join_date = excluded.join_date,
      cessation_date = excluded.cessation_date,
      legacy_data = coalesce(cessations.legacy_data, '{}'::jsonb) || excluded.legacy_data,
      updated_at = now();
  end if;

  return new;
end;
$$;

revoke all on function public.sync_staff_cessation_record() from public, anon, authenticated;

drop trigger if exists staff_profiles_sync_cessation on public.staff_profiles;
create trigger staff_profiles_sync_cessation
after insert or update of cessation_date, store_id, join_date, first_name, last_name, dni, gender, position
on public.staff_profiles
for each row execute function public.sync_staff_cessation_record();

create or replace function public.save_staff_cessation(
  p_staff_id uuid,
  p_cessation_date date,
  p_performance text default 'BUENO',
  p_cessation_reason text default 'RENUNCIA VOLUNTARIA',
  p_real_reason text default 'MEJORA ECONÓMICA',
  p_store_comment text default null,
  p_medical_leave_days numeric default 0,
  p_absences numeric default 0,
  p_tardiness text default null,
  p_night_hours numeric default 0,
  p_extra_hours numeric default 0,
  p_holidays numeric default 0,
  p_discounts numeric default 0
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.staff_profiles
  set cessation_date = p_cessation_date, updated_at = now()
  where id = p_staff_id;

  if not found then
    raise exception 'Colaborador no encontrado o sin permisos';
  end if;

  if p_cessation_date is not null then
    update public.cessations
    set
      performance = nullif(trim(p_performance), ''),
      cessation_reason = nullif(trim(p_cessation_reason), ''),
      real_reason = nullif(trim(p_real_reason), ''),
      store_comment = nullif(trim(p_store_comment), ''),
      medical_leave_days = greatest(coalesce(p_medical_leave_days, 0), 0),
      absences = greatest(coalesce(p_absences, 0), 0),
      tardiness = nullif(trim(p_tardiness), ''),
      night_hours = greatest(coalesce(p_night_hours, 0), 0),
      extra_hours = greatest(coalesce(p_extra_hours, 0), 0),
      holidays = greatest(coalesce(p_holidays, 0), 0),
      discounts = greatest(coalesce(p_discounts, 0), 0),
      updated_at = now()
    where staff_id = p_staff_id and not is_modality_change;
  end if;
end;
$$;

revoke all on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) from public, anon;
grant execute on function public.save_staff_cessation(
  uuid, date, text, text, text, text, numeric, numeric, text,
  numeric, numeric, numeric, numeric
) to authenticated;
