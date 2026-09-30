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
security definer
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
  order by assignment.channel, assignment.schedule_label;
end;
$$;

comment on function public.get_my_suggestive_sales_goals(date) is
  'Devuelve únicamente las metas del perfil de colaborador vinculado al usuario autenticado.';

revoke all on function public.get_my_suggestive_sales_goals(date) from public;
revoke all on function public.get_my_suggestive_sales_goals(date) from anon;
grant execute on function public.get_my_suggestive_sales_goals(date) to authenticated;
