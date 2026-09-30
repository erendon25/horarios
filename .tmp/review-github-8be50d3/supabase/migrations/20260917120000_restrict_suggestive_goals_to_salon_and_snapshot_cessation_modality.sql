-- Preserve the modality on new cessation records and scope this family of
-- suggestive-sales goals exclusively to SALÓN. Existing historical rows are
-- intentionally retained; the UI provides a non-destructive profile fallback.

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
      staff_id,
      store_id,
      join_date,
      cessation_date,
      previous_modality,
      is_modality_change,
      cessation_reason,
      real_reason,
      legacy_data
    ) values (
      new.id,
      new.store_id,
      new.join_date,
      new.cessation_date,
      nullif(btrim(new.modality), ''),
      false,
      'RENUNCIA VOLUNTARIA',
      'MEJORA ECONÓMICA',
      identity_data
    )
    on conflict (staff_id) where not is_modality_change
    do update set
      store_id = excluded.store_id,
      join_date = excluded.join_date,
      cessation_date = excluded.cessation_date,
      previous_modality = coalesce(
        nullif(btrim(cessations.previous_modality), ''),
        excluded.previous_modality
      ),
      legacy_data = coalesce(cessations.legacy_data, '{}'::jsonb) || excluded.legacy_data,
      updated_at = now();
  end if;

  return new;
end;
$$;

create or replace function private.publish_suggestive_sales_goals(
  p_store_id uuid,
  p_month_start date,
  p_rows jsonb,
  p_targets jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_staff_id uuid;
  v_goal_date date;
  v_channel text;
  v_schedule_label text;
  v_inserted integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_store_id is null
    or p_month_start is null
    or extract(day from p_month_start) <> 1
    or jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_targets, '{}'::jsonb)) <> 'object'
  then
    raise exception 'Invalid suggestive sales publication payload' using errcode = '22023';
  end if;

  if not (
    (select private.current_user_role()) = 'superadmin'
    or (
      (select private.current_user_role()) = 'admin'
      and p_store_id = (select private.current_user_store_id())
    )
  ) then
    raise exception 'Only store administrators can publish suggestive sales goals' using errcode = '42501';
  end if;

  delete from public.suggestive_sales_goal_assignments
  where store_id = p_store_id
    and goal_date >= p_month_start
    and goal_date < (p_month_start + interval '1 month')::date;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_staff_id := (v_row ->> 'staffId')::uuid;
      v_goal_date := (v_row ->> 'date')::date;
      v_channel := v_row ->> 'channel';
      v_schedule_label := left(coalesce(nullif(v_row ->> 'schedule', ''), 'Horario no disponible'), 120);
    exception when others then
      raise exception 'Invalid suggestive sales assignment row' using errcode = '22023';
    end;

    if v_goal_date < p_month_start
      or v_goal_date >= (p_month_start + interval '1 month')::date
      or v_channel <> 'SALÓN'
      or jsonb_typeof(coalesce(v_row -> 'goals', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(v_row -> 'hourlyGoals', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(v_row -> 'coveredHours', '[]'::jsonb)) <> 'array'
      or not exists (
        select 1
        from public.staff_profiles staff
        where staff.id = v_staff_id and staff.store_id = p_store_id
      )
    then
      raise exception 'Suggestive sales assignment is outside SALÓN, the authorized store or month' using errcode = '22023';
    end if;

    insert into public.suggestive_sales_goal_assignments (
      store_id,
      staff_id,
      goal_date,
      channel,
      schedule_label,
      goals,
      hourly_goals,
      covered_hours,
      monthly_targets,
      published_by
    ) values (
      p_store_id,
      v_staff_id,
      v_goal_date,
      v_channel,
      v_schedule_label,
      coalesce(v_row -> 'goals', '{}'::jsonb),
      coalesce(v_row -> 'hourlyGoals', '{}'::jsonb),
      coalesce(v_row -> 'coveredHours', '[]'::jsonb),
      p_targets,
      (select auth.uid())
    );

    v_inserted := v_inserted + 1;
  end loop;

  return v_inserted;
end;
$$;

create or replace function public.get_my_suggestive_sales_goals(p_goal_date date)
returns table (
  id bigint,
  goal_date date,
  channel text,
  schedule_label text,
  goals jsonb,
  hourly_goals jsonb,
  covered_hours jsonb,
  monthly_targets jsonb,
  published_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_goal_date is null then
    raise exception 'Goal date is required' using errcode = '22023';
  end if;

  return query
  select
    assignment.id,
    assignment.goal_date,
    assignment.channel,
    assignment.schedule_label,
    assignment.goals,
    assignment.hourly_goals,
    assignment.covered_hours,
    assignment.monthly_targets,
    assignment.published_at
  from public.suggestive_sales_goal_assignments assignment
  join public.staff_profiles staff on staff.id = assignment.staff_id
  where staff.user_id = (select auth.uid())
    and assignment.goal_date = p_goal_date
    and assignment.channel = 'SALÓN'
  order by assignment.schedule_label;
end;
$$;

comment on function public.get_my_suggestive_sales_goals(date) is
  'Devuelve únicamente las metas de SALÓN del perfil vinculado al usuario autenticado.';

revoke all on function public.get_my_suggestive_sales_goals(date) from public;
revoke all on function public.get_my_suggestive_sales_goals(date) from anon;
grant execute on function public.get_my_suggestive_sales_goals(date) to authenticated;
