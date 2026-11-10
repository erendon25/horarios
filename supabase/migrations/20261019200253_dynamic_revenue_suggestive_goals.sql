-- Dynamic monetary goals; existing monthly snapshots and RLS remain intact.
-- Historical snapshots can contain labels such as MÓDULO. Keep their table
-- constraint compatible; new revenue publications use the four IDs below.
alter table public.suggestive_sales_goal_assignments
  drop constraint suggestive_sales_goal_assignments_channel_check;
alter table public.suggestive_sales_goal_assignments
  add constraint suggestive_sales_goal_assignments_channel_check
  check (length(btrim(channel)) between 1 and 80 and channel !~ '[[:cntrl:]]');

create or replace function private.valid_suggestive_goal_map(p_goals jsonb, p_product_ids text[])
returns boolean language sql immutable security invoker set search_path = '' as $$
  select case when jsonb_typeof(p_goals) = 'object' then
    (select count(*) from jsonb_object_keys(p_goals)) = cardinality(p_product_ids)
    and not exists (
      select 1 from jsonb_each(p_goals) item
      where not (item.key = any(p_product_ids))
      or not case when jsonb_typeof(item.value) = 'number' then
        (item.value::text)::numeric between 0 and 9007199254740991
        and trunc((item.value::text)::numeric) = (item.value::text)::numeric
      else false end
    ) else false end;
$$;
revoke all on function private.valid_suggestive_goal_map(jsonb,text[]) from public, anon, authenticated;

create or replace function private.publish_suggestive_sales_goals(
  p_store_id uuid, p_month_start date, p_rows jsonb, p_targets jsonb
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb;
  v_staff_id uuid;
  v_date date;
  v_channel text;
  v_schedule text;
  v_inserted integer := 0;
  v_revenue boolean;
  v_product_ids text[];
  v_report_names text[];
  v_channel_ids text[];
  v_product_id text;
  v_goal_map jsonb;
  v_hour jsonb;
  v_covered integer[];
  v_hours integer[];
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not coalesce((select private.current_user_role()) = 'superadmin'
    or ((select private.current_user_role()) = 'admin'
      and p_store_id = (select private.current_user_store_id())), false) then
    raise exception 'Only store administrators can publish suggestive sales goals' using errcode = '42501';
  end if;
  if p_store_id is null or p_month_start is null or extract(day from p_month_start) <> 1
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_typeof(p_targets) is distinct from 'object' then
    raise exception 'Invalid suggestive sales publication payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 50000 then
    raise exception 'Too many suggestive sales assignments' using errcode = '22023';
  end if;
  v_revenue := coalesce(p_targets #>> '{calculation,basis}' = 'channel_sales_revenue', false);
  if v_revenue then
    if jsonb_typeof(p_targets #> '{calculation,products}') is distinct from 'array'
      or jsonb_typeof(p_targets #> '{calculation,channels}') is distinct from 'array'
      or jsonb_typeof(p_targets #> '{calculation,participation}') is distinct from 'number' then
      raise exception 'Invalid monetary product/channel configuration' using errcode = '22023';
    end if;
    if jsonb_array_length(p_targets #> '{calculation,products}') not between 1 and 50
      or jsonb_array_length(p_targets #> '{calculation,channels}') not between 1 and 4
      or (p_targets #>> '{calculation,participation}')::numeric not between 0 and 1
      or exists (
        select 1 from jsonb_array_elements(p_targets #> '{calculation,products}') product
        where jsonb_typeof(product) is distinct from 'object'
          or jsonb_typeof(product -> 'id') is distinct from 'string'
          or coalesce(product ->> 'id', '') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$'
          or jsonb_typeof(product -> 'label') is distinct from 'string'
          or length(btrim(coalesce(product ->> 'label', ''))) not between 1 and 160
          or jsonb_typeof(product -> 'reportName') is distinct from 'string'
          or length(btrim(coalesce(product ->> 'reportName', ''))) not between 1 and 160
          or (product ->> 'reportName') ~ '[[:cntrl:]]'
          or not case when jsonb_typeof(product -> 'price') = 'number'
            then (product ->> 'price')::numeric > 0 and (product ->> 'price')::numeric <= 1000000000
            else false end
      ) or exists (
        select 1 from jsonb_array_elements(p_targets #> '{calculation,channels}') channel
        where jsonb_typeof(channel) is distinct from 'object'
          or jsonb_typeof(channel -> 'id') is distinct from 'string'
          or coalesce(channel ->> 'id', '') not in ('SALÓN', 'DRIVE THRU', 'SERV. FILA', 'SERV. AUTO')
      ) then
      raise exception 'Invalid monetary product/channel configuration' using errcode = '22023';
    end if;
    select array_agg(product ->> 'id') into v_product_ids
      from jsonb_array_elements(p_targets #> '{calculation,products}') product;
    -- Report names are exact and case sensitive, matching the report importer.
    select array_agg(btrim(product ->> 'reportName')) into v_report_names
      from jsonb_array_elements(p_targets #> '{calculation,products}') product;
    select array_agg(channel ->> 'id') into v_channel_ids
      from jsonb_array_elements(p_targets #> '{calculation,channels}') channel;
    if cardinality(v_product_ids) <> (select count(distinct id) from unnest(v_product_ids) id)
      or cardinality(v_report_names) <> (select count(distinct report_name) from unnest(v_report_names) report_name)
      or cardinality(v_channel_ids) <> (select count(distinct id) from unnest(v_channel_ids) id) then
      raise exception 'Duplicate products, report names or channels' using errcode = '22023';
    end if;
  else
    -- Preserve publications from the former, three-product SALÓN client.
    v_product_ids := array['cheeseBorder','hazloCanelitasV3','hazloCrazyV3'];
    v_channel_ids := array['SALÓN'];
  end if;
  select jsonb_object_agg(id, p_targets -> id) into v_goal_map from unnest(v_product_ids) id;
  if not private.valid_suggestive_goal_map(v_goal_map, v_product_ids) then
    raise exception 'Invalid monthly product targets' using errcode = '22023';
  end if;

  delete from public.suggestive_sales_goal_assignments
    where store_id = p_store_id and goal_date >= p_month_start
      and goal_date < (p_month_start + interval '1 month')::date;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    begin
      v_staff_id := (v_row ->> 'staffId')::uuid;
      v_date := (v_row ->> 'date')::date;
      v_channel := v_row ->> 'channel';
      v_schedule := coalesce(nullif(btrim(v_row ->> 'schedule'), ''), 'Horario no disponible');
    exception when others then
      raise exception 'Invalid suggestive sales assignment row' using errcode = '22023';
    end;
    if v_staff_id is null or v_date is null or v_channel is null
      or v_date < p_month_start or v_date >= (p_month_start + interval '1 month')::date
      or not (v_channel = any(v_channel_ids)) or length(v_schedule) > 120
      or not private.valid_suggestive_goal_map(v_row -> 'goals', v_product_ids)
      or jsonb_typeof(v_row -> 'hourlyGoals') is distinct from 'object'
      or jsonb_typeof(v_row -> 'coveredHours') is distinct from 'array'
      or not exists (select 1 from public.staff_profiles staff where staff.id = v_staff_id and staff.store_id = p_store_id) then
      raise exception 'Assignment outside the authorized store, month or configuration' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_each(v_row -> 'hourlyGoals') slot
      where slot.key !~ '^(0|[1-9]|1[0-9]|2[0-3])$'
      or not private.valid_suggestive_goal_map(slot.value, v_product_ids))
      or exists (select 1 from jsonb_array_elements(v_row -> 'coveredHours') hour
        where not case when jsonb_typeof(hour) = 'number' then
          (hour::text)::numeric between 0 and 23 and trunc((hour::text)::numeric) = (hour::text)::numeric
          else false end) then
      raise exception 'Invalid suggestive sales hourly goals' using errcode = '22023';
    end if;
    select array_agg((hour::text)::integer order by (hour::text)::integer) into v_covered
      from jsonb_array_elements(v_row -> 'coveredHours') hour;
    select array_agg(hour::integer order by hour::integer) into v_hours
      from jsonb_object_keys(v_row -> 'hourlyGoals') hour;
    if coalesce(v_covered, array[]::integer[]) <> coalesce(v_hours, array[]::integer[]) then
      raise exception 'Covered hours must match the hourly goals exactly' using errcode = '22023';
    end if;
    foreach v_product_id in array v_product_ids loop
      if (v_row -> 'goals' ->> v_product_id)::numeric <> coalesce((
        select sum((value ->> v_product_id)::numeric) from jsonb_each(v_row -> 'hourlyGoals')
      ), 0) then
        raise exception 'Hourly totals do not match the collaborator goal' using errcode = '22023';
      end if;
    end loop;
    insert into public.suggestive_sales_goal_assignments (
      store_id,staff_id,goal_date,channel,schedule_label,goals,hourly_goals,covered_hours,monthly_targets,published_by
    ) values (p_store_id,v_staff_id,v_date,v_channel,v_schedule,v_row -> 'goals',v_row -> 'hourlyGoals',v_row -> 'coveredHours',p_targets,(select auth.uid()));
    v_inserted := v_inserted + 1;
  end loop;
  foreach v_product_id in array v_product_ids loop
    if coalesce((select sum((goals ->> v_product_id)::numeric) from public.suggestive_sales_goal_assignments
      where store_id = p_store_id and goal_date >= p_month_start and goal_date < (p_month_start + interval '1 month')::date),0)
      > (p_targets ->> v_product_id)::numeric then
      raise exception 'Assigned goals exceed the monthly product target' using errcode = '22023';
    end if;
  end loop;
  return v_inserted;
end;
$$;
revoke all on function private.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb) from public, anon;
grant execute on function private.publish_suggestive_sales_goals(uuid,date,jsonb,jsonb) to authenticated, service_role;

-- Keep the public RPC wrapper SECURITY INVOKER and the existing table RLS.
create or replace function public.get_my_suggestive_sales_goals(p_goal_date date)
returns table(id bigint,goal_date date,channel text,schedule_label text,goals jsonb,hourly_goals jsonb,
  covered_hours jsonb,monthly_targets jsonb,published_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_goal_date is null then raise exception 'Goal date is required' using errcode = '22023'; end if;
  return query select assignment.id,assignment.goal_date,assignment.channel,assignment.schedule_label,
    assignment.goals,assignment.hourly_goals,assignment.covered_hours,assignment.monthly_targets,assignment.published_at
  from public.suggestive_sales_goal_assignments assignment
  join public.staff_profiles staff on staff.id = assignment.staff_id and staff.store_id = assignment.store_id
  where staff.user_id = (select auth.uid()) and assignment.goal_date = p_goal_date
    and ((assignment.monthly_targets #>> '{calculation,basis}' = 'channel_sales_revenue')
      or (assignment.channel = 'SALÓN' and assignment.goals ?& array['cheeseBorder','hazloCanelitasV3','hazloCrazyV3']))
  order by assignment.channel,assignment.schedule_label;
end;
$$;
revoke all on function public.get_my_suggestive_sales_goals(date) from public, anon;
grant execute on function public.get_my_suggestive_sales_goals(date) to authenticated;
comment on function public.get_my_suggestive_sales_goals(date) is
  'Only assignments of the authenticated staff profile, including configured revenue products/channels and current legacy SALÓN goals.';
