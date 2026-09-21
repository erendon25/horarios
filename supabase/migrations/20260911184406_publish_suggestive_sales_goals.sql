create table public.suggestive_sales_goal_assignments (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores(id) on delete cascade,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  goal_date date not null,
  channel text not null check (channel in ('SALÓN', 'DRIVE THRU', 'SERV. FILA')),
  schedule_label text not null,
  goals jsonb not null default '{}'::jsonb check (jsonb_typeof(goals) = 'object'),
  hourly_goals jsonb not null default '{}'::jsonb check (jsonb_typeof(hourly_goals) = 'object'),
  covered_hours jsonb not null default '[]'::jsonb check (jsonb_typeof(covered_hours) = 'array'),
  monthly_targets jsonb not null default '{}'::jsonb check (jsonb_typeof(monthly_targets) = 'object'),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (store_id, staff_id, goal_date, channel, schedule_label)
);

comment on table public.suggestive_sales_goal_assignments is
  'Metas calculadas y publicadas para cada colaborador. No contiene el histórico de ventas que originó el cálculo.';

create index suggestive_sales_goal_assignments_staff_date_idx
  on public.suggestive_sales_goal_assignments (staff_id, goal_date);

create index suggestive_sales_goal_assignments_store_date_idx
  on public.suggestive_sales_goal_assignments (store_id, goal_date);

alter table public.suggestive_sales_goal_assignments enable row level security;

create policy suggestive_sales_goal_assignments_read
  on public.suggestive_sales_goal_assignments
  for select
  to authenticated
  using (
    staff_id = (select private.current_staff_profile_id())
    or (select private.current_user_role()) = 'superadmin'
    or (
      store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  );

revoke all on table public.suggestive_sales_goal_assignments from anon;
revoke all on table public.suggestive_sales_goal_assignments from authenticated;
grant select on table public.suggestive_sales_goal_assignments to authenticated;

create or replace function public.publish_suggestive_sales_goals(
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
      or v_channel not in ('SALÓN', 'DRIVE THRU', 'SERV. FILA')
      or jsonb_typeof(coalesce(v_row -> 'goals', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(v_row -> 'hourlyGoals', '{}'::jsonb)) <> 'object'
      or jsonb_typeof(coalesce(v_row -> 'coveredHours', '[]'::jsonb)) <> 'array'
      or not exists (
        select 1
        from public.staff_profiles sp
        where sp.id = v_staff_id and sp.store_id = p_store_id
      )
    then
      raise exception 'Suggestive sales assignment is outside the authorized store or month' using errcode = '22023';
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

comment on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) is
  'Reemplaza atómicamente las metas publicadas de un mes. Valida usuario administrador, tienda, mes y colaboradores.';

revoke all on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) from public;
revoke all on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) from anon;
grant execute on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) to authenticated;
