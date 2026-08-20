-- Esquema declarativo inicial para migrar Firestore a Supabase/PostgreSQL.
-- No ejecutar en producción sin probar primero en un proyecto Supabase de desarrollo.

create extension if not exists pgcrypto;
create schema if not exists private;

create type public.app_role as enum ('superadmin', 'admin', 'trainer', 'collaborator');
create type public.record_status as enum ('pending', 'active', 'inactive');
create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.evaluation_status as enum ('draft', 'completed');
create type public.holiday_balance_type as enum ('ganado', 'compensado');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  name text not null,
  city text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  firebase_uid text unique,
  store_id uuid references public.stores(id) on delete restrict,
  staff_profile_id uuid,
  email text,
  first_name text,
  last_name text,
  role public.app_role not null default 'collaborator',
  status public.record_status not null default 'active',
  registration_pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  firestore_id text unique,
  user_id uuid unique references auth.users(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email text,
  dni text,
  gender text check (gender is null or gender in ('MASCULINO', 'FEMENINO')),
  birth_date date,
  modality text check (modality is null or modality in ('Full-Time', 'Part-Time')),
  position text not null default 'COLABORADOR',
  status public.record_status not null default 'pending',
  join_date date,
  cessation_date date,
  sanitary_card_expiry date,
  sanitary_card_unlock boolean not null default false,
  is_trainee boolean not null default false,
  training_end_date date,
  modality_change_date date,
  next_modality text check (next_modality is null or next_modality in ('Full-Time', 'Part-Time')),
  needs_completion boolean not null default false,
  holiday_balance numeric(8,2) not null default 0,
  last_evaluation_date date,
  last_evaluation_score numeric(5,2),
  last_station_evaluated text,
  training_scores jsonb not null default '{}'::jsonb,
  position_abilities jsonb not null default '[]'::jsonb,
  pending_holidays jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_at timestamptz,
  legacy_data jsonb not null default '{}'::jsonb,
  constraint staff_training_dates_check check (not is_trainee or cessation_date is null),
  constraint staff_modality_change_check check (
    (modality_change_date is null and next_modality is null)
    or (modality_change_date is not null and next_modality is not null)
  )
);

alter table public.user_profiles
  add constraint user_profiles_staff_profile_id_fkey
  foreign key (staff_profile_id) references public.staff_profiles(id) on delete set null;

create table public.staff_skills (
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  skill_code text not null,
  acquired_at timestamptz not null default now(),
  primary key (staff_id, skill_code)
);

create table public.store_positions (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  code text not null,
  name text not null,
  calculation_logic text not null default 'capacity'
    check (calculation_logic in ('capacity', 'service', 'driver', 'fixed')),
  capacity numeric(12,2),
  factor numeric(10,4) not null default 1,
  ticket_average numeric(12,2),
  transactions_per_collaborator numeric(12,2),
  fixed_staff integer check (fixed_staff is null or fixed_staff >= 0),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb,
  unique (store_id, code)
);

alter table public.staff_skills add column store_position_id bigint
  references public.store_positions(id) on delete set null;

create table public.store_positioning_requirements (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  requirement_key text not null,
  requirements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, requirement_key)
);

create table public.schedule_weeks (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  week_start date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb,
  unique (staff_id, week_start)
);

create table public.schedule_shifts (
  id bigint generated always as identity primary key,
  schedule_week_id bigint not null references public.schedule_weeks(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  position text,
  is_day_off boolean not null default false,
  is_holiday boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  unique (schedule_week_id, work_date),
  constraint schedule_shift_time_check check (
    is_day_off or is_holiday or (start_time is not null and end_time is not null)
  )
);

create table public.study_schedule_days (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  requests_day_off boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (staff_id, weekday)
);

create table public.study_schedule_blocks (
  id bigint generated always as identity primary key,
  study_day_id bigint not null references public.study_schedule_days(id) on delete cascade,
  start_time time not null,
  end_time time not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint study_block_time_check check (start_time <> end_time),
  unique (study_day_id, start_time, end_time)
);

create table public.worked_holidays (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  holiday_date date not null,
  name text not null,
  balance_type public.holiday_balance_type not null,
  created_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb,
  unique (staff_id, holiday_date)
);

create table public.extra_hours (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid references public.staff_profiles(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete cascade,
  work_date date not null,
  start_time time,
  end_time time,
  duration_minutes integer not null default 0 check (duration_minutes >= 0),
  pre_shift_minutes integer not null default 0 check (pre_shift_minutes >= 0),
  post_shift_minutes integer not null default 0 check (post_shift_minutes >= 0),
  activity text,
  source text not null default 'manual',
  source_file text,
  imported_at timestamptz,
  segments jsonb not null default '[]'::jsonb,
  daily_details jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.cessations (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  join_date date,
  cessation_date date not null,
  previous_modality text,
  next_modality text,
  is_modality_change boolean not null default false,
  performance text,
  cessation_reason text,
  real_reason text,
  store_comment text,
  medical_leave_days numeric(8,2) not null default 0,
  absences numeric(8,2) not null default 0,
  tardiness text,
  night_hours numeric(10,2) not null default 0,
  extra_hours numeric(10,2) not null default 0,
  holidays numeric(10,2) not null default 0,
  discounts numeric(12,2) not null default 0,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb,
  constraint cessations_regular_reasons_check check (
    is_modality_change or (cessation_reason is not null and real_reason is not null)
  ),
  unique (staff_id, cessation_date, is_modality_change)
);

create table public.schedule_requests (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  requested_date date not null,
  shift_type text not null,
  start_time time,
  end_time time,
  reason text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.training_evaluations (
  id bigint generated always as identity primary key,
  firestore_id text unique,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  trainer_id uuid references auth.users(id) on delete set null,
  store_id uuid not null references public.stores(id) on delete cascade,
  evaluation_date date not null,
  area text,
  station_code text,
  station_name text,
  score numeric(5,2) check (score is null or score between 0 and 100),
  responses jsonb not null default '{}'::jsonb,
  feedback jsonb not null default '{}'::jsonb,
  general_findings text,
  status public.evaluation_status not null default 'draft',
  current_step integer,
  collaborator_signature_path text,
  trainer_signature_path text,
  is_edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.store_configs (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  config_key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, config_key)
);

create table public.sales_month_configs (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  month_start date not null check (extract(day from month_start) = 1),
  monthly_data jsonb not null default '{}'::jsonb,
  daily_hourly_parts jsonb not null default '{}'::jsonb,
  real_sales_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, month_start)
);

create table public.sales_daily_history (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  sales_amount numeric(14,2),
  transactions integer,
  hourly_data jsonb not null default '{}'::jsonb,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sales_date)
);

create table public.sales_hourly_history (
  id bigint generated always as identity primary key,
  sales_daily_id bigint not null references public.sales_daily_history(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  sales_hour time not null,
  sales_amount numeric(14,2) not null default 0,
  transactions integer not null default 0 check (transactions >= 0),
  participation_percentage numeric(8,5),
  source_data jsonb not null default '{}'::jsonb,
  unique (store_id, sales_date, sales_hour)
);

create table public.sales_projections (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null references public.stores(id) on delete cascade,
  week_start date not null,
  source text not null default 'manual',
  source_file text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb,
  unique (store_id, week_start)
);

-- Plantilla semanal vigente migrada desde config/schedule_projection.
-- Se separa de sales_projections porque Firebase no guarda una week_start.
create table public.sales_projection_templates (
  id bigint generated always as identity primary key,
  firestore_id text,
  store_id uuid not null unique references public.stores(id) on delete cascade,
  positions jsonb not null default '[]'::jsonb,
  sales_by_day jsonb not null default '{}'::jsonb,
  requirements jsonb not null default '{}'::jsonb,
  manual_staff_by_day jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  legacy_data jsonb not null default '{}'::jsonb
);

create table public.sales_projection_hours (
  id bigint generated always as identity primary key,
  projection_id bigint not null references public.sales_projections(id) on delete cascade,
  projection_date date not null,
  projection_hour time not null,
  projected_sales numeric(14,2) not null default 0,
  projected_transactions numeric(14,2),
  unique (projection_id, projection_date, projection_hour)
);

create table public.staffing_projection_hours (
  id bigint generated always as identity primary key,
  sales_projection_hour_id bigint not null references public.sales_projection_hours(id) on delete cascade,
  store_position_id bigint not null references public.store_positions(id) on delete cascade,
  calculated_staff integer not null default 0 check (calculated_staff >= 0),
  manual_staff integer check (manual_staff is null or manual_staff >= 0),
  required_staff integer not null default 0 check (required_staff >= 0),
  calculation_inputs jsonb not null default '{}'::jsonb,
  unique (sales_projection_hour_id, store_position_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'IMPORT')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- Índices para claves foráneas, filtros por tienda y consultas cronológicas.
create index user_profiles_store_id_idx on public.user_profiles (store_id);
create index user_profiles_staff_profile_id_idx on public.user_profiles (staff_profile_id);
create index staff_profiles_store_status_idx on public.staff_profiles (store_id, status);
create index staff_profiles_user_id_idx on public.staff_profiles (user_id);
create index staff_profiles_store_cessation_idx on public.staff_profiles (store_id, cessation_date);
create index store_positioning_requirements_store_idx on public.store_positioning_requirements (store_id);
create index store_positions_store_active_idx on public.store_positions (store_id, is_active);
create index staff_skills_position_idx on public.staff_skills (store_position_id);
create index schedule_weeks_store_week_idx on public.schedule_weeks (store_id, week_start);
create index schedule_weeks_staff_idx on public.schedule_weeks (staff_id);
create index schedule_shifts_week_date_idx on public.schedule_shifts (schedule_week_id, work_date);
create index study_schedule_days_staff_idx on public.study_schedule_days (staff_id);
create index study_schedule_blocks_day_idx on public.study_schedule_blocks (study_day_id);
create index worked_holidays_store_date_idx on public.worked_holidays (store_id, holiday_date);
create index worked_holidays_user_idx on public.worked_holidays (user_id);
create index extra_hours_store_date_idx on public.extra_hours (store_id, work_date);
create index extra_hours_staff_date_idx on public.extra_hours (staff_id, work_date);
create index extra_hours_user_idx on public.extra_hours (user_id);
create index cessations_store_date_idx on public.cessations (store_id, cessation_date);
create index cessations_staff_idx on public.cessations (staff_id);
create unique index cessations_one_regular_per_staff_idx on public.cessations (staff_id)
  where not is_modality_change;
create index schedule_requests_store_status_date_idx on public.schedule_requests (store_id, status, requested_date);
create index schedule_requests_user_idx on public.schedule_requests (user_id);
create index schedule_requests_staff_idx on public.schedule_requests (staff_id);
create index schedule_requests_reviewed_by_idx on public.schedule_requests (reviewed_by);
create index training_evaluations_store_date_idx on public.training_evaluations (store_id, evaluation_date);
create index training_evaluations_staff_date_idx on public.training_evaluations (staff_id, evaluation_date);
create index training_evaluations_trainer_idx on public.training_evaluations (trainer_id);
create index store_configs_store_idx on public.store_configs (store_id);
create index store_configs_updated_by_idx on public.store_configs (updated_by);
create index sales_month_configs_store_idx on public.sales_month_configs (store_id, month_start);
create index sales_daily_history_store_date_idx on public.sales_daily_history (store_id, sales_date);
create index sales_hourly_history_daily_idx on public.sales_hourly_history (sales_daily_id);
create index sales_hourly_history_store_date_idx on public.sales_hourly_history (store_id, sales_date, sales_hour);
create index sales_projections_store_week_idx on public.sales_projections (store_id, week_start);
create index sales_projections_created_by_idx on public.sales_projections (created_by);
create index sales_projection_hours_projection_idx on public.sales_projection_hours (projection_id, projection_date);
create index staffing_projection_hours_sales_hour_idx on public.staffing_projection_hours (sales_projection_hour_id);
create index staffing_projection_hours_position_idx on public.staffing_projection_hours (store_position_id);
create index audit_log_store_created_idx on public.audit_log (store_id, created_at desc);
create index audit_log_actor_id_idx on public.audit_log (actor_id);

-- Helpers RLS. La identidad se toma de auth.uid(), nunca de user_metadata.
create or replace function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select up.role from public.user_profiles up where up.id = (select auth.uid())
$$;

create or replace function private.current_user_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select up.store_id from public.user_profiles up where up.id = (select auth.uid())
$$;

revoke all on function private.current_user_role() from public, anon;
revoke all on function private.current_user_store_id() from public, anon;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_store_id() to authenticated;

-- Activar RLS en todas las tablas expuestas.
alter table public.stores enable row level security;
alter table public.user_profiles enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_skills enable row level security;
alter table public.store_positions enable row level security;
alter table public.store_positioning_requirements enable row level security;
alter table public.schedule_weeks enable row level security;
alter table public.schedule_shifts enable row level security;
alter table public.study_schedule_days enable row level security;
alter table public.study_schedule_blocks enable row level security;
alter table public.worked_holidays enable row level security;
alter table public.extra_hours enable row level security;
alter table public.cessations enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.training_evaluations enable row level security;
alter table public.store_configs enable row level security;
alter table public.sales_month_configs enable row level security;
alter table public.sales_daily_history enable row level security;
alter table public.sales_hourly_history enable row level security;
alter table public.sales_projections enable row level security;
alter table public.sales_projection_templates enable row level security;
alter table public.sales_projection_hours enable row level security;
alter table public.staffing_projection_hours enable row level security;
alter table public.audit_log enable row level security;

-- Privilegios base; RLS decide qué filas puede usar cada usuario.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy stores_authenticated_read on public.stores for select to authenticated using (true);
create policy stores_superadmin_write on public.stores for all to authenticated
  using ((select private.current_user_role()) = 'superadmin')
  with check ((select private.current_user_role()) = 'superadmin');

create policy user_profiles_read on public.user_profiles for select to authenticated using (
  id = (select auth.uid())
  or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy user_profiles_admin_update on public.user_profiles for update to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (
      store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) = 'admin'
      and role <> 'superadmin'
    )
  );

create policy staff_profiles_read on public.staff_profiles for select to authenticated using (
  user_id = (select auth.uid())
  or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy staff_profiles_admin_write on public.staff_profiles for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
-- Políticas repetibles por tienda para datos operativos directos.
create policy worked_holidays_read on public.worked_holidays for select to authenticated using (
  user_id = (select auth.uid()) or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy worked_holidays_write on public.worked_holidays for all to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = worked_holidays.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = worked_holidays.store_id
      )
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = worked_holidays.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = worked_holidays.store_id
      )
    )
  );

create policy extra_hours_read on public.extra_hours for select to authenticated using (
  user_id = (select auth.uid()) or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy extra_hours_write on public.extra_hours for all to authenticated
  using (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = extra_hours.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = extra_hours.store_id
      )
    )
  )
  with check (
    (select private.current_user_role()) = 'superadmin'
    or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin')
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.staff_profiles sp
        where sp.id = extra_hours.staff_id
          and sp.user_id = (select auth.uid())
          and sp.store_id = extra_hours.store_id
      )
    )
  );

create policy schedule_requests_read on public.schedule_requests for select to authenticated using (
  user_id = (select auth.uid()) or (select private.current_user_role()) = 'superadmin'
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy schedule_requests_create on public.schedule_requests for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and admin_comment is null
    and exists (
      select 1 from public.staff_profiles sp
      where sp.id = schedule_requests.staff_id
        and sp.user_id = (select auth.uid())
        and sp.store_id = schedule_requests.store_id
    )
  );
create policy schedule_requests_admin_update on public.schedule_requests for update to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy schedule_requests_admin_delete on public.schedule_requests for delete to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));

-- Las tablas restantes se habilitan primero para administradores de tienda y superadmin.
-- Las políticas de colaborador se añadirán al migrar cada módulo y sus consultas reales.
create policy cessations_admin_all on public.cessations for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy store_configs_access on public.store_configs for select to authenticated using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy store_configs_admin_write on public.store_configs for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));

create policy store_positions_read on public.store_positions for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy store_positions_admin_write on public.store_positions for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));

create policy positioning_requirements_read on public.store_positioning_requirements for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy positioning_requirements_admin_write on public.store_positioning_requirements for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));

create policy staff_skills_read on public.staff_skills for select to authenticated using (
  (select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id
      and (sp.user_id = (select auth.uid()) or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer')))
  )
);
create policy staff_skills_store_write on public.staff_skills for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  ))
  with check ((select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  ));

create policy schedule_weeks_read on public.schedule_weeks for select to authenticated using (
  (select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id
      and (sp.user_id = (select auth.uid()) or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer')))
  )
);
create policy schedule_weeks_admin_write on public.schedule_weeks for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy schedule_shifts_read on public.schedule_shifts for select to authenticated using (
  exists (select 1 from public.schedule_weeks sw where sw.id = schedule_week_id)
);
create policy schedule_shifts_admin_write on public.schedule_shifts for all to authenticated
  using (exists (select 1 from public.schedule_weeks sw where sw.id = schedule_week_id and ((select private.current_user_role()) = 'superadmin' or (sw.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))))
  with check (exists (select 1 from public.schedule_weeks sw where sw.id = schedule_week_id and ((select private.current_user_role()) = 'superadmin' or (sw.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))));

create policy study_days_read on public.study_schedule_days for select to authenticated using (
  (select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id
      and (sp.user_id = (select auth.uid()) or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer')))
  )
);
create policy study_days_write on public.study_schedule_days for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id
      and (sp.user_id = (select auth.uid()) or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  ))
  with check ((select private.current_user_role()) = 'superadmin' or exists (
    select 1 from public.staff_profiles sp where sp.id = staff_id
      and (sp.user_id = (select auth.uid()) or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  ));
create policy study_blocks_read on public.study_schedule_blocks for select to authenticated
  using (exists (select 1 from public.study_schedule_days sd where sd.id = study_day_id));
create policy study_blocks_write on public.study_schedule_blocks for all to authenticated
  using (exists (select 1 from public.study_schedule_days sd where sd.id = study_day_id))
  with check (exists (select 1 from public.study_schedule_days sd where sd.id = study_day_id));

create policy training_evaluations_read on public.training_evaluations for select to authenticated using (
  (select private.current_user_role()) = 'superadmin' or trainer_id = (select auth.uid())
  or exists (select 1 from public.staff_profiles sp where sp.id = staff_id and sp.user_id = (select auth.uid()))
  or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer'))
);
create policy training_evaluations_store_write on public.training_evaluations for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer')))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) in ('admin', 'trainer')));

create policy sales_month_read on public.sales_month_configs for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy sales_month_admin_write on public.sales_month_configs for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy sales_daily_read on public.sales_daily_history for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy sales_daily_admin_write on public.sales_daily_history for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy sales_hourly_read on public.sales_hourly_history for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy sales_hourly_admin_write on public.sales_hourly_history for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy sales_projections_read on public.sales_projections for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy sales_projections_admin_write on public.sales_projections for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy sales_projection_templates_read on public.sales_projection_templates for select to authenticated
  using (store_id = (select private.current_user_store_id()) or (select private.current_user_role()) = 'superadmin');
create policy sales_projection_templates_admin_write on public.sales_projection_templates for all to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))
  with check ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));
create policy sales_projection_hours_read on public.sales_projection_hours for select to authenticated
  using (exists (select 1 from public.sales_projections sp where sp.id = projection_id));
create policy sales_projection_hours_write on public.sales_projection_hours for all to authenticated
  using (exists (select 1 from public.sales_projections sp where sp.id = projection_id and ((select private.current_user_role()) = 'superadmin' or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))))
  with check (exists (select 1 from public.sales_projections sp where sp.id = projection_id and ((select private.current_user_role()) = 'superadmin' or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))));
create policy staffing_projection_read on public.staffing_projection_hours for select to authenticated
  using (exists (select 1 from public.sales_projection_hours sph where sph.id = sales_projection_hour_id));
create policy staffing_projection_write on public.staffing_projection_hours for all to authenticated
  using (exists (select 1 from public.sales_projection_hours sph join public.sales_projections sp on sp.id = sph.projection_id where sph.id = sales_projection_hour_id and ((select private.current_user_role()) = 'superadmin' or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))))
  with check (exists (select 1 from public.sales_projection_hours sph join public.sales_projections sp on sp.id = sph.projection_id where sph.id = sales_projection_hour_id and ((select private.current_user_role()) = 'superadmin' or (sp.store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'))));

create policy audit_log_admin_read on public.audit_log for select to authenticated
  using ((select private.current_user_role()) = 'superadmin' or (store_id = (select private.current_user_store_id()) and (select private.current_user_role()) = 'admin'));

-- Comentarios de mapeo Firestore:
-- users -> user_profiles; staff_profiles -> staff_profiles + staff_skills
-- schedules -> schedule_weeks + schedule_shifts
-- study_schedules -> study_schedule_days + study_schedule_blocks
-- feriados_trabajados/worked_holidays -> worked_holidays
-- extra_hours -> extra_hours; ceses -> cessations
-- schedule_requests -> schedule_requests; training_evaluations -> training_evaluations
-- stores/{id}/config -> store_configs
-- stores/{id}/positioning_requirements -> store_positioning_requirements
-- stores/{id}/sales_config -> sales_month_configs
-- stores/{id}/sales_history -> sales_daily_history
