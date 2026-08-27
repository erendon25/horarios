-- Harden the collaborator identity graph without guessing identities.
-- Applied remotely as migration version 20260827030014.
--
-- This migration intentionally leaves ambiguous historical records in
-- private.staff_linkage_issues.  New writes are required to carry a canonical
-- staff/store link, while administrative accounts keep their store-scoped
-- access even when they do not represent a staff member.

create schema if not exists private;

-- Future Data API objects must be granted deliberately.  Supabase historically
-- installed permissive defaults for both owners; revoke them when the owner is
-- present so a newly-created table/function is not exposed by accident.
do $acl$
declare
  v_owner text;
begin
  foreach v_owner in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = v_owner)
       and pg_has_role(current_user, v_owner, 'member') then
      execute format(
        'alter default privileges for role %I in schema public revoke all on tables from anon, authenticated',
        v_owner
      );
      execute format(
        'alter default privileges for role %I in schema public revoke all on sequences from anon, authenticated',
        v_owner
      );
      execute format(
        'alter default privileges for role %I in schema public revoke execute on functions from public, anon, authenticated',
        v_owner
      );
    elsif exists (select 1 from pg_roles where rolname = v_owner) then
      raise notice 'Default privileges for role % require an owner-level maintenance action', v_owner;
    end if;
  end loop;
end;
$acl$;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
revoke all on schema private from public, anon;
revoke all on all tables in schema private from public, anon, authenticated;

-- These tables are written through audited RPCs (or are append-only logs).
-- Keep authenticated grants no broader than their current application paths.
revoke insert, delete on public.user_profiles from authenticated;
revoke delete on public.staff_profiles from authenticated;
revoke insert, update, delete on public.schedule_weeks from authenticated;
revoke insert, update, delete on public.schedule_shifts from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;

grant usage on schema private to authenticated, service_role;

create table if not exists private.staff_linkage_issues (
  entity text not null,
  record_key text not null,
  issue_code text not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (entity, record_key, issue_code),
  constraint staff_linkage_issues_entity_check check (length(btrim(entity)) between 1 and 80),
  constraint staff_linkage_issues_record_key_check check (length(btrim(record_key)) between 1 and 300),
  constraint staff_linkage_issues_code_check check (length(btrim(issue_code)) between 1 and 120),
  constraint staff_linkage_issues_details_check check (jsonb_typeof(details) = 'object')
);

alter table private.staff_linkage_issues enable row level security;
revoke all on private.staff_linkage_issues from public, anon, authenticated;
grant select, insert, update on private.staff_linkage_issues to service_role;

insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
select
  'database_acl',
  owner_role.rolname,
  'default_privileges_require_owner_action',
  jsonb_build_object('migrationRole', current_user)
from pg_roles owner_role
where owner_role.rolname in ('postgres', 'supabase_admin')
  and not pg_has_role(current_user, owner_role.rolname, 'member')
on conflict (entity, record_key, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

-- A staff profile may belong to at most one account.  The old non-unique FK
-- index is retained because it remains useful for lookups.
create unique index if not exists user_profiles_staff_profile_id_uidx
  on public.user_profiles (staff_profile_id)
  where staff_profile_id is not null;

-- Existing disconnected accounts remain in place for the registration flow,
-- but no longer masquerade as fully-linked active collaborators.
update public.user_profiles up
set registration_pending = true,
    updated_at = now()
where up.role in ('trainer', 'collaborator')
  and up.status = 'active'
  and not up.registration_pending
  and not exists (
    select 1
    from public.staff_profiles sp
    join public.stores s on s.id = sp.store_id
    where sp.id = up.staff_profile_id
      and sp.user_id = up.id
      and up.store_id = sp.store_id
      and s.is_active
      and (
        sp.cessation_date is null
        or sp.cessation_date >= (now() at time zone 'America/Lima')::date
      )
  );

-- Conversely, repair only registration flags whose complete inverse link is
-- already proven.  This is the safe unlock for linked accounts imported with a
-- stale registration_pending=true value.
update public.user_profiles up
set registration_pending = false,
    updated_at = now()
where up.role in ('trainer', 'collaborator')
  and up.status = 'active'
  and up.registration_pending
  and exists (
    select 1
    from public.staff_profiles sp
    join public.stores s on s.id = sp.store_id
    where sp.id = up.staff_profile_id
      and sp.user_id = up.id
      and up.store_id = sp.store_id
      and s.is_active
      and (
        sp.cessation_date is null
        or sp.cessation_date >= (now() at time zone 'America/Lima')::date
      )
  );

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_profiles'::regclass
      and conname = 'user_profiles_active_staff_link_check'
  ) then
    alter table public.user_profiles
      add constraint user_profiles_active_staff_link_check check (
        role not in ('trainer', 'collaborator')
        or status <> 'active'
        or registration_pending
        or (staff_profile_id is not null and store_id is not null)
      ) not valid;
  end if;
end;
$constraint$;

insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
select
  'user_profiles',
  up.id::text,
  'active_account_without_canonical_staff_link',
  jsonb_build_object(
    'role', up.role,
    'hasStaffProfileId', up.staff_profile_id is not null,
    'hasStoreId', up.store_id is not null
  )
from public.user_profiles up
where up.role in ('trainer', 'collaborator')
  and up.status = 'active'
  and not exists (
    select 1
    from public.staff_profiles sp
    join public.stores s on s.id = sp.store_id
    where sp.id = up.staff_profile_id
      and sp.user_id = up.id
      and up.store_id = sp.store_id
      and s.is_active
      and (
        sp.cessation_date is null
        or sp.cessation_date >= (now() at time zone 'America/Lima')::date
      )
  )
on conflict (entity, record_key, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

update private.staff_linkage_issues i
set resolved_at = now()
where i.entity = 'user_profiles'
  and i.issue_code = 'active_account_without_canonical_staff_link'
  and i.resolved_at is null
  and not exists (
    select 1
    from public.user_profiles up
    where up.id::text = i.record_key
      and up.role in ('trainer', 'collaborator')
      and up.status = 'active'
      and not exists (
        select 1
        from public.staff_profiles sp
        join public.stores s on s.id = sp.store_id
        where sp.id = up.staff_profile_id
          and sp.user_id = up.id
          and up.store_id = sp.store_id
          and s.is_active
          and (
            sp.cessation_date is null
            or sp.cessation_date >= (now() at time zone 'America/Lima')::date
          )
      )
  );

-- Resolve caller identity from the bidirectional link.  Deliberately do not
-- require staff_profiles.status='active': imported data currently uses that
-- field as an HR lifecycle value and it is not yet reconciled with account
-- status.  Effective cessations and inactive stores are still denied.
create or replace function private.current_staff_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select up.staff_profile_id
  from public.user_profiles up
  join public.staff_profiles sp
    on sp.id = up.staff_profile_id
   and sp.user_id = up.id
   and sp.store_id = up.store_id
  join public.stores s
    on s.id = sp.store_id
   and s.is_active
  where up.id = (select auth.uid())
    and up.status = 'active'
    and not up.registration_pending
    and (
      sp.cessation_date is null
      or sp.cessation_date >= (now() at time zone 'America/Lima')::date
    )
  limit 1
$function$;

create or replace function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $function$
  select up.role
  from public.user_profiles up
  where up.id = (select auth.uid())
    and up.status = 'active'
    and (
      up.role in ('superadmin', 'admin')
      or up.staff_profile_id = (select private.current_staff_profile_id())
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
  where up.id = (select auth.uid())
    and up.status = 'active'
    and (
      up.role in ('superadmin', 'admin')
      or up.staff_profile_id = (select private.current_staff_profile_id())
    )
  limit 1
$function$;

revoke all on function private.current_staff_profile_id() from public, anon;
revoke all on function private.current_user_role() from public, anon;
revoke all on function private.current_user_store_id() from public, anon;
grant execute on function private.current_staff_profile_id() to authenticated;
grant execute on function private.current_user_role() to authenticated;
grant execute on function private.current_user_store_id() to authenticated;

-- Row ownership is always staff_profile_id, never a loose user_id match.  The
-- administrative/trainer branches remain store-scoped and superadmin remains
-- global.
drop policy if exists user_profiles_read on public.user_profiles;
create policy user_profiles_read
on public.user_profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

drop policy if exists staff_profiles_read on public.staff_profiles;
create policy staff_profiles_read
on public.staff_profiles
for select
to authenticated
using (
  id = (select private.current_staff_profile_id())
  or (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

drop policy if exists staff_skills_read on public.staff_skills;
create policy staff_skills_read
on public.staff_skills
for select
to authenticated
using (
  staff_id = (select private.current_staff_profile_id())
  or (select private.current_user_role()) = 'superadmin'
  or exists (
    select 1
    from public.staff_profiles sp
    where sp.id = staff_skills.staff_id
      and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

drop policy if exists staff_skills_store_write on public.staff_skills;
create policy staff_skills_store_write
on public.staff_skills
for all
to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or exists (
    select 1
    from public.staff_profiles sp
    where sp.id = staff_skills.staff_id
      and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  )
)
with check (
  (select private.current_user_role()) = 'superadmin'
  or exists (
    select 1
    from public.staff_profiles sp
    where sp.id = staff_skills.staff_id
      and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

drop policy if exists schedule_weeks_read on public.schedule_weeks;
create policy schedule_weeks_read
on public.schedule_weeks
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

drop policy if exists schedule_shifts_read on public.schedule_shifts;
create policy schedule_shifts_read
on public.schedule_shifts
for select
to authenticated
using (
  exists (
    select 1
    from public.schedule_weeks sw
    where sw.id = schedule_shifts.schedule_week_id
      and (
        sw.staff_id = (select private.current_staff_profile_id())
        or (select private.current_user_role()) = 'superadmin'
        or (
          sw.store_id = (select private.current_user_store_id())
          and (select private.current_user_role()) in ('admin', 'trainer')
        )
      )
  )
);

drop policy if exists study_days_read on public.study_schedule_days;
create policy study_days_read
on public.study_schedule_days
for select
to authenticated
using (
  staff_id = (select private.current_staff_profile_id())
  or (select private.current_user_role()) = 'superadmin'
  or exists (
    select 1
    from public.staff_profiles sp
    where sp.id = study_schedule_days.staff_id
      and sp.store_id = (select private.current_user_store_id())
      and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

drop policy if exists study_blocks_read on public.study_schedule_blocks;
create policy study_blocks_read
on public.study_schedule_blocks
for select
to authenticated
using (
  exists (
    select 1
    from public.study_schedule_days sd
    join public.staff_profiles sp on sp.id = sd.staff_id
    where sd.id = study_schedule_blocks.study_day_id
      and (
        sd.staff_id = (select private.current_staff_profile_id())
        or (select private.current_user_role()) = 'superadmin'
        or (
          sp.store_id = (select private.current_user_store_id())
          and (select private.current_user_role()) in ('admin', 'trainer')
        )
      )
  )
);

drop policy if exists worked_holidays_read on public.worked_holidays;
create policy worked_holidays_read
on public.worked_holidays
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

drop policy if exists worked_holidays_write on public.worked_holidays;
drop policy if exists worked_holidays_insert on public.worked_holidays;
drop policy if exists worked_holidays_staff_insert on public.worked_holidays;
create policy worked_holidays_staff_insert
on public.worked_holidays
for insert
to authenticated
with check (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
  or (
    staff_id = (select private.current_staff_profile_id())
    and user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('trainer', 'collaborator')
    and balance_type = 'ganado'
    and holiday_date <= (now() at time zone 'America/Lima')::date
  )
);

drop policy if exists worked_holidays_admin_delete on public.worked_holidays;
create policy worked_holidays_admin_delete
on public.worked_holidays
for delete
to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
);

drop policy if exists extra_hours_read on public.extra_hours;
create policy extra_hours_read
on public.extra_hours
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

drop policy if exists extra_hours_write on public.extra_hours;
drop policy if exists extra_hours_insert on public.extra_hours;
create policy extra_hours_insert
on public.extra_hours
for insert
to authenticated
with check (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
  or (
    staff_id = (select private.current_staff_profile_id())
    and user_id = (select auth.uid())
    and store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('trainer', 'collaborator')
    and source = 'manual'
  )
);

drop policy if exists extra_hours_admin_update on public.extra_hours;
create policy extra_hours_admin_update
on public.extra_hours
for update
to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
)
with check (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
);

drop policy if exists extra_hours_delete on public.extra_hours;
create policy extra_hours_delete
on public.extra_hours
for delete
to authenticated
using (
  (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) = 'admin'
  )
  or (
    staff_id = (select private.current_staff_profile_id())
    and user_id = (select auth.uid())
    and source = 'manual'
  )
);

drop policy if exists schedule_requests_read on public.schedule_requests;
create policy schedule_requests_read
on public.schedule_requests
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

drop policy if exists schedule_requests_create on public.schedule_requests;
create policy schedule_requests_create
on public.schedule_requests
for insert
to authenticated
with check (
  staff_id = (select private.current_staff_profile_id())
  and user_id = (select auth.uid())
  and store_id = (select private.current_user_store_id())
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and admin_comment is null
);

drop policy if exists training_evaluations_read on public.training_evaluations;
create policy training_evaluations_read
on public.training_evaluations
for select
to authenticated
using (
  staff_id = (select private.current_staff_profile_id())
  or trainer_id = (select auth.uid())
  or (select private.current_user_role()) = 'superadmin'
  or (
    store_id = (select private.current_user_store_id())
    and (select private.current_user_role()) in ('admin', 'trainer')
  )
);

-- Resolve position IDs with a deterministic preference for a unique normalized
-- code, then a unique normalized name in the same store.
create or replace function private.resolve_store_position_id(
  p_store_id uuid,
  p_skill_code text
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (
      select case when count(*) = 1 then min(p.id) end
      from public.store_positions p
      where p.store_id = p_store_id
        and lower(btrim(p.code)) = lower(btrim(p_skill_code))
    ),
    (
      select case when count(*) = 1 then min(p.id) end
      from public.store_positions p
      where p.store_id = p_store_id
        and lower(btrim(p.name)) = lower(btrim(p_skill_code))
    )
  )
$function$;

revoke all on function private.resolve_store_position_id(uuid, text) from public, anon, authenticated;

-- Enforce the canonical staff/store pair on every HR table that stores both
-- columns.  Existing quarantined rows are untouched; all future inserts and
-- changes must be complete and consistent.
create or replace function private.enforce_staff_store_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store_id uuid;
begin
  if new.staff_id is null then
    raise exception using
      errcode = '23502',
      message = format('%s.staff_id is required', tg_table_name);
  end if;

  if new.store_id is null then
    raise exception using
      errcode = '23502',
      message = format('%s.store_id is required', tg_table_name);
  end if;

  select sp.store_id
  into v_store_id
  from public.staff_profiles sp
  where sp.id = new.staff_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = format('%s references an unknown staff profile', tg_table_name);
  end if;

  if new.store_id <> v_store_id then
    raise exception using
      errcode = '23514',
      message = format('%s.store_id does not match the staff profile', tg_table_name);
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_staff_store_link() from public, anon, authenticated;

do $triggers$
declare
  v_table text;
begin
  foreach v_table in array array[
    'schedule_weeks',
    'worked_holidays',
    'extra_hours',
    'cessations',
    'schedule_requests',
    'training_evaluations'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I',
      v_table || '_enforce_staff_store',
      v_table
    );
    execute format(
      'create trigger %I before insert or update of staff_id, store_id on public.%I for each row execute function private.enforce_staff_store_link()',
      v_table || '_enforce_staff_store',
      v_table
    );
  end loop;
end;
$triggers$;

-- Direct skill writes remain available to the existing training UI, but their
-- optional position FK can never point to another store.  A unique mapping is
-- filled automatically; an unmappable legacy code is recorded for follow-up.
create or replace function private.enforce_staff_skill_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store_id uuid;
  v_position_store_id uuid;
begin
  new.skill_code := btrim(new.skill_code);
  if new.skill_code = '' then
    raise exception using errcode = '23514', message = 'skill_code cannot be empty';
  end if;

  select sp.store_id
  into v_store_id
  from public.staff_profiles sp
  where sp.id = new.staff_id;

  if not found then
    raise exception using errcode = '23503', message = 'Unknown staff profile';
  end if;

  if new.store_position_id is null then
    new.store_position_id := private.resolve_store_position_id(v_store_id, new.skill_code);
  else
    select p.store_id
    into v_position_store_id
    from public.store_positions p
    where p.id = new.store_position_id;

    if not found then
      raise exception using errcode = '23503', message = 'Unknown store position';
    end if;

    if v_position_store_id <> v_store_id then
      raise exception using errcode = '23514', message = 'Skill position belongs to another store';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function private.refresh_staff_skill_projection(p_staff_id uuid)
returns void
language sql
security definer
set search_path = ''
as $function$
  update public.staff_profiles sp
  set position_abilities = coalesce(
        (
          select jsonb_agg(to_jsonb(ss.skill_code) order by ss.acquired_at, ss.skill_code)
          from public.staff_skills ss
          where ss.staff_id = p_staff_id
        ),
        '[]'::jsonb
      ),
      updated_at = now()
  where sp.id = p_staff_id
$function$;

create or replace function private.sync_staff_skill_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff_id uuid;
  v_record_key text;
begin
  if tg_op = 'DELETE' then
    v_staff_id := old.staff_id;
    v_record_key := old.staff_id::text || ':' || old.skill_code;
  else
    v_staff_id := new.staff_id;
    v_record_key := new.staff_id::text || ':' || new.skill_code;
  end if;

  perform private.refresh_staff_skill_projection(v_staff_id);

  if tg_op = 'DELETE' then
    update private.staff_linkage_issues
    set resolved_at = now()
    where entity = 'staff_skills'
      and record_key = v_record_key
      and issue_code in ('unmappable_store_position', 'store_position_from_different_store')
      and resolved_at is null;
  elsif new.store_position_id is not null then
    update private.staff_linkage_issues
    set resolved_at = now()
    where entity = 'staff_skills'
      and record_key = v_record_key
      and issue_code in ('unmappable_store_position', 'store_position_from_different_store')
      and resolved_at is null;
  else
    insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
    values (
      'staff_skills',
      v_record_key,
      'unmappable_store_position',
      jsonb_build_object('hasStorePositionId', false)
    )
    on conflict (entity, record_key, issue_code) do update
    set details = excluded.details,
        detected_at = now(),
        resolved_at = null;
  end if;

  if tg_op = 'UPDATE'
     and (old.staff_id, old.skill_code) is distinct from (new.staff_id, new.skill_code) then
    update private.staff_linkage_issues
    set resolved_at = now()
    where entity = 'staff_skills'
      and record_key = old.staff_id::text || ':' || old.skill_code
      and resolved_at is null;
  end if;

  return null;
end;
$function$;

revoke all on function private.enforce_staff_skill_position() from public, anon, authenticated;
revoke all on function private.refresh_staff_skill_projection(uuid) from public, anon, authenticated;
revoke all on function private.sync_staff_skill_projection() from public, anon, authenticated;

drop trigger if exists staff_skills_enforce_position on public.staff_skills;
create trigger staff_skills_enforce_position
before insert or update of staff_id, skill_code, store_position_id
on public.staff_skills
for each row execute function private.enforce_staff_skill_position();

drop trigger if exists staff_skills_sync_projection on public.staff_skills;
create trigger staff_skills_sync_projection
after insert or update or delete
on public.staff_skills
for each row execute function private.sync_staff_skill_projection();

-- Rebuild the denormalized projection once after the deterministic backfill.
update public.staff_profiles sp
set position_abilities = coalesce(
      (
        select jsonb_agg(to_jsonb(ss.skill_code) order by ss.acquired_at, ss.skill_code)
        from public.staff_skills ss
        where ss.staff_id = sp.id
      ),
      '[]'::jsonb
    ),
    updated_at = now()
where sp.position_abilities is distinct from coalesce(
  (
    select jsonb_agg(to_jsonb(ss.skill_code) order by ss.acquired_at, ss.skill_code)
    from public.staff_skills ss
    where ss.staff_id = sp.id
  ),
  '[]'::jsonb
);

-- Contract used by the Vite compatibility layer: a PostgreSQL text[] of store
-- position codes.  Replacement, mapping and projection refresh are one DB
-- transaction.  Existing acquisition timestamps are preserved on conflict.
create or replace function public.replace_staff_skills(
  p_staff_id uuid,
  p_skill_codes text[]
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

  select *
  into v_staff
  from public.staff_profiles
  where id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  if not (
    v_role = 'superadmin'
    or (v_role in ('admin', 'trainer') and v_store_id = v_staff.store_id)
  ) then
    raise exception 'No tienes permiso para actualizar estas habilidades';
  end if;

  p_skill_codes := coalesce(p_skill_codes, array[]::text[]);

  if cardinality(p_skill_codes) > 100 then
    raise exception 'Se permiten como máximo 100 habilidades';
  end if;

  if exists (
    select 1
    from unnest(p_skill_codes) as requested(skill_code)
    where requested.skill_code is null
       or nullif(btrim(requested.skill_code), '') is null
       or length(btrim(requested.skill_code)) > 120
  ) then
    raise exception 'La lista contiene una habilidad inválida';
  end if;

  if exists (
    select 1
    from unnest(p_skill_codes) as requested(skill_code)
    group by lower(btrim(requested.skill_code))
    having count(*) > 1
  ) then
    raise exception 'La lista contiene habilidades duplicadas';
  end if;

  if exists (
    select 1
    from unnest(p_skill_codes) as requested(skill_code)
    where private.resolve_store_position_id(v_staff.store_id, requested.skill_code) is null
  ) then
    raise exception 'Una o más habilidades no pertenecen a posiciones configuradas en la tienda';
  end if;

  insert into public.staff_skills (staff_id, skill_code, acquired_at, store_position_id)
  select distinct
    v_staff.id,
    pos.code,
    now(),
    pos.id
  from unnest(p_skill_codes) as requested(skill_code)
  join public.store_positions pos
    on pos.id = private.resolve_store_position_id(v_staff.store_id, requested.skill_code)
  on conflict (staff_id, skill_code) do update
  set store_position_id = excluded.store_position_id;

  delete from public.staff_skills ss
  where ss.staff_id = v_staff.id
    and not exists (
      select 1
      from unnest(p_skill_codes) as requested(skill_code)
      join public.store_positions pos
        on pos.id = private.resolve_store_position_id(v_staff.store_id, requested.skill_code)
      where pos.code = ss.skill_code
    );

  perform private.refresh_staff_skill_projection(v_staff.id);
end;
$function$;

revoke all on function public.replace_staff_skills(uuid, text[]) from public, anon;
grant execute on function public.replace_staff_skills(uuid, text[]) to authenticated;

-- Completing an evaluation now updates the staff summary and certification in
-- the same transaction as the evaluation row.  The existing client-side upsert
-- remains harmless because the staff skill key is idempotent.
create or replace function private.apply_completed_training_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_position_id bigint;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  if new.score is not null
     and new.score >= 90
     and nullif(btrim(new.station_code), '') is not null then
    v_position_id := private.resolve_store_position_id(new.store_id, new.station_code);

    insert into public.staff_skills (
      staff_id,
      skill_code,
      acquired_at,
      store_position_id
    ) values (
      new.staff_id,
      btrim(new.station_code),
      new.evaluation_date::timestamp at time zone 'America/Lima',
      v_position_id
    )
    on conflict (staff_id, skill_code) do update
    set acquired_at = least(public.staff_skills.acquired_at, excluded.acquired_at),
        store_position_id = coalesce(excluded.store_position_id, public.staff_skills.store_position_id);
  end if;

  update public.staff_profiles sp
  set training_scores = case
        when nullif(btrim(new.station_code), '') is null or new.score is null
          then sp.training_scores
        else jsonb_set(
          coalesce(sp.training_scores, '{}'::jsonb),
          array[btrim(new.station_code)],
          to_jsonb(new.score),
          true
        )
      end,
      last_evaluation_date = case
        when sp.last_evaluation_date is null or new.evaluation_date >= sp.last_evaluation_date
          then new.evaluation_date
        else sp.last_evaluation_date
      end,
      last_evaluation_score = case
        when sp.last_evaluation_date is null or new.evaluation_date >= sp.last_evaluation_date
          then new.score
        else sp.last_evaluation_score
      end,
      last_station_evaluated = case
        when sp.last_evaluation_date is null or new.evaluation_date >= sp.last_evaluation_date
          then new.station_code
        else sp.last_station_evaluated
      end,
      updated_at = now()
  where sp.id = new.staff_id;

  return new;
end;
$function$;

revoke all on function private.apply_completed_training_evaluation() from public, anon, authenticated;

drop trigger if exists training_evaluations_apply_completion on public.training_evaluations;
create trigger training_evaluations_apply_completion
after insert or update of status, score, station_code, evaluation_date, staff_id, store_id
on public.training_evaluations
for each row execute function private.apply_completed_training_evaluation();

-- Repair only extra-hours identities that follow an already-valid inverse link.
-- Ambiguous manual imports are retained and quarantined below.
update public.extra_hours eh
set staff_id = up.staff_profile_id,
    store_id = sp.store_id,
    updated_at = now()
from public.user_profiles up
join public.staff_profiles sp
  on sp.id = up.staff_profile_id
 and sp.user_id = up.id
 and sp.store_id = up.store_id
where eh.user_id = up.id
  and (eh.staff_id is null or eh.staff_id = sp.id)
  and (eh.store_id is null or eh.store_id = sp.store_id)
  and (eh.staff_id is null or eh.store_id is null);

update public.extra_hours eh
set store_id = sp.store_id,
    updated_at = now()
from public.staff_profiles sp
where eh.staff_id = sp.id
  and eh.store_id is null;

update public.extra_hours eh
set user_id = sp.user_id,
    updated_at = now()
from public.staff_profiles sp
join public.user_profiles up
  on up.id = sp.user_id
 and up.staff_profile_id = sp.id
 and up.store_id = sp.store_id
where eh.staff_id = sp.id
  and eh.user_id is null
  and sp.user_id is not null;

insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
select
  'extra_hours',
  eh.id::text,
  'missing_or_inconsistent_staff_store_link',
  jsonb_build_object(
    'hasStaffId', eh.staff_id is not null,
    'hasUserId', eh.user_id is not null,
    'hasStoreId', eh.store_id is not null,
    'source', eh.source,
    'storeMatchesStaff', coalesce(eh.store_id = sp.store_id, false)
  )
from public.extra_hours eh
left join public.staff_profiles sp on sp.id = eh.staff_id
where eh.staff_id is null
   or eh.store_id is null
   or sp.id is null
   or eh.store_id <> sp.store_id
on conflict (entity, record_key, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

update private.staff_linkage_issues i
set resolved_at = now()
where i.entity = 'extra_hours'
  and i.issue_code = 'missing_or_inconsistent_staff_store_link'
  and i.resolved_at is null
  and not exists (
    select 1
    from public.extra_hours eh
    left join public.staff_profiles sp on sp.id = eh.staff_id
    where eh.id::text = i.record_key
      and (
        eh.staff_id is null
        or eh.store_id is null
        or sp.id is null
        or eh.store_id <> sp.store_id
      )
  );

-- Normalize legacy pending holiday dates into the relational source of truth.
-- Only values PostgreSQL can parse as dates, not later than today in Lima, are
-- migrated.  Unparseable/future entries stay in the legacy array.
with expanded as (
  select
    sp.id as staff_id,
    sp.user_id,
    sp.store_id,
    h.value,
    h.ordinality,
    case
      when jsonb_typeof(h.value) = 'string'
       and pg_input_is_valid(h.value #>> '{}', 'date')
      then (h.value #>> '{}')::date
    end as holiday_date
  from public.staff_profiles sp
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(sp.pending_holidays) = 'array' then sp.pending_holidays
      else '[]'::jsonb
    end
  ) with ordinality as h(value, ordinality)
), candidates as (
  select distinct staff_id, user_id, store_id, holiday_date
  from expanded
  where holiday_date is not null
    and holiday_date <= (now() at time zone 'America/Lima')::date
)
insert into public.worked_holidays (
  staff_id,
  user_id,
  store_id,
  holiday_date,
  name,
  balance_type,
  legacy_data
)
select
  c.staff_id,
  c.user_id,
  c.store_id,
  c.holiday_date,
  'Feriado pendiente migrado',
  'ganado'::public.holiday_balance_type,
  jsonb_build_object('source', 'staff_profiles.pending_holidays')
from candidates c
on conflict (staff_id, holiday_date) do nothing;

with expanded as (
  select
    sp.id as staff_id,
    h.value,
    h.ordinality,
    case
      when jsonb_typeof(h.value) = 'string'
       and pg_input_is_valid(h.value #>> '{}', 'date')
      then (h.value #>> '{}')::date
    end as holiday_date
  from public.staff_profiles sp
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(sp.pending_holidays) = 'array' then sp.pending_holidays
      else '[]'::jsonb
    end
  ) with ordinality as h(value, ordinality)
), grouped as (
  select
    e.staff_id,
    coalesce(
      jsonb_agg(e.value order by e.ordinality) filter (
        where e.holiday_date is null
           or e.holiday_date > (now() at time zone 'America/Lima')::date
           or not exists (
             select 1
             from public.worked_holidays wh
             where wh.staff_id = e.staff_id
               and wh.holiday_date = e.holiday_date
           )
      ),
      '[]'::jsonb
    ) as remaining_values,
    jsonb_agg(e.value order by e.ordinality) filter (
      where e.holiday_date is not null
        and e.holiday_date <= (now() at time zone 'America/Lima')::date
        and exists (
          select 1
          from public.worked_holidays wh
          where wh.staff_id = e.staff_id
            and wh.holiday_date = e.holiday_date
        )
    ) as migrated_values
  from expanded e
  group by e.staff_id
)
update public.staff_profiles sp
set pending_holidays = g.remaining_values,
    legacy_data = coalesce(sp.legacy_data, '{}'::jsonb) || jsonb_build_object(
      'pendingHolidaysMigration',
      jsonb_build_object('migratedAt', now(), 'values', g.migrated_values)
    ),
    updated_at = now()
from grouped g
where sp.id = g.staff_id
  and g.migrated_values is not null;

update public.staff_skills ss
set store_position_id = private.resolve_store_position_id(sp.store_id, ss.skill_code)
from public.staff_profiles sp
where sp.id = ss.staff_id
  and ss.store_position_id is null
  and private.resolve_store_position_id(sp.store_id, ss.skill_code) is not null;

insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
select
  'staff_skills',
  ss.staff_id::text || ':' || ss.skill_code,
  'unmappable_store_position',
  jsonb_build_object('hasStorePositionId', false)
from public.staff_skills ss
where ss.store_position_id is null
on conflict (entity, record_key, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

insert into private.staff_linkage_issues (entity, record_key, issue_code, details)
select
  'staff_skills',
  ss.staff_id::text || ':' || ss.skill_code,
  'store_position_from_different_store',
  jsonb_build_object('hasStorePositionId', true)
from public.staff_skills ss
join public.staff_profiles sp on sp.id = ss.staff_id
join public.store_positions pos on pos.id = ss.store_position_id
where pos.store_id <> sp.store_id
on conflict (entity, record_key, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

update private.staff_linkage_issues i
set resolved_at = now()
where i.entity = 'staff_skills'
  and i.issue_code in ('unmappable_store_position', 'store_position_from_different_store')
  and i.resolved_at is null
  and not exists (
    select 1
    from public.staff_skills ss
    join public.staff_profiles sp on sp.id = ss.staff_id
    left join public.store_positions pos on pos.id = ss.store_position_id
    where ss.staff_id::text || ':' || ss.skill_code = i.record_key
      and (
        (i.issue_code = 'unmappable_store_position' and ss.store_position_id is null)
        or (
          i.issue_code = 'store_position_from_different_store'
          and ss.store_position_id is not null
          and pos.store_id <> sp.store_id
        )
      )
  );

-- Keep the scalar RPC contract already consumed by Next/Vite.  It is an
-- invoker function so table RLS remains a second authorization boundary.
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
security invoker
set search_path = ''
as $function$
declare
  v_caller_role public.app_role := private.current_user_role();
  v_caller_store_id uuid := private.current_user_store_id();
  v_existing public.staff_profiles%rowtype;
  v_staff_id uuid;
  v_user_id uuid;
  v_effective_status public.record_status;
  v_is_trainee boolean := coalesce(p_is_trainee, false);
  v_next_modality text := nullif(btrim(p_next_modality), '');
  v_linked_profile public.user_profiles%rowtype;
begin
  if v_caller_role not in ('superadmin', 'admin') then
    raise exception 'No tienes permiso para administrar colaboradores';
  end if;

  if p_store_id is null then
    raise exception 'La tienda es obligatoria';
  end if;

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'La tienda no existe';
  end if;

  if v_caller_role = 'admin' and v_caller_store_id is distinct from p_store_id then
    raise exception 'No puedes administrar colaboradores de otra tienda';
  end if;

  if nullif(btrim(p_first_name), '') is null
     or nullif(btrim(p_last_name), '') is null then
    raise exception 'Nombre y apellido son obligatorios';
  end if;

  if nullif(btrim(p_position), '') is null then
    raise exception 'La posición es obligatoria';
  end if;

  if p_status is null then
    raise exception 'El estado es obligatorio';
  end if;

  if (p_modality_change_date is null) <> (v_next_modality is null) then
    raise exception 'La fecha y la nueva modalidad deben registrarse juntas';
  end if;

  if p_staff_id is not null then
    select *
    into v_existing
    from public.staff_profiles sp
    where sp.id = p_staff_id
    for update;

    if not found then
      raise exception 'Colaborador no encontrado o sin permisos';
    end if;

    if v_caller_role = 'admin'
       and v_existing.store_id is distinct from v_caller_store_id then
      raise exception 'No puedes mover colaboradores desde otra tienda';
    end if;

    v_user_id := v_existing.user_id;
  end if;

  -- An unlinked staff record is a registration candidate, not an authenticated
  -- active account.  The invitation/claim RPC activates both sides atomically.
  v_effective_status := case
    when v_user_id is null and p_status = 'active' then 'pending'::public.record_status
    else p_status
  end;

  if p_staff_id is null then
    insert into public.staff_profiles (
      store_id,
      first_name,
      last_name,
      email,
      dni,
      gender,
      birth_date,
      modality,
      position,
      status,
      join_date,
      sanitary_card_expiry,
      sanitary_card_unlock,
      is_trainee,
      training_end_date,
      modality_change_date,
      next_modality
    ) values (
      p_store_id,
      btrim(p_first_name),
      btrim(p_last_name),
      nullif(lower(btrim(p_email)), ''),
      nullif(btrim(p_dni), ''),
      nullif(btrim(p_gender), ''),
      p_birth_date,
      nullif(btrim(p_modality), ''),
      btrim(p_position),
      v_effective_status,
      p_join_date,
      p_sanitary_card_expiry,
      coalesce(p_sanitary_card_unlock, false),
      v_is_trainee,
      case when v_is_trainee then p_training_end_date end,
      p_modality_change_date,
      v_next_modality
    )
    returning id, user_id into v_staff_id, v_user_id;
  else
    update public.staff_profiles sp
    set store_id = p_store_id,
        first_name = btrim(p_first_name),
        last_name = btrim(p_last_name),
        email = nullif(lower(btrim(p_email)), ''),
        dni = nullif(btrim(p_dni), ''),
        gender = nullif(btrim(p_gender), ''),
        birth_date = p_birth_date,
        modality = nullif(btrim(p_modality), ''),
        position = btrim(p_position),
        status = v_effective_status,
        join_date = p_join_date,
        sanitary_card_expiry = p_sanitary_card_expiry,
        sanitary_card_unlock = coalesce(p_sanitary_card_unlock, false),
        is_trainee = v_is_trainee,
        cessation_date = case when v_is_trainee then null else sp.cessation_date end,
        training_end_date = case when v_is_trainee then p_training_end_date end,
        modality_change_date = p_modality_change_date,
        next_modality = v_next_modality,
        updated_at = now()
    where sp.id = p_staff_id
    returning sp.id, sp.user_id into v_staff_id, v_user_id;

    if not found then
      raise exception 'Colaborador no encontrado o sin permisos';
    end if;
  end if;

  if v_user_id is not null then
    select *
    into v_linked_profile
    from public.user_profiles up
    where up.id = v_user_id
    for update;

    if not found then
      raise exception 'La cuenta vinculada no tiene un perfil de usuario válido';
    end if;

    if v_linked_profile.staff_profile_id is not null
       and v_linked_profile.staff_profile_id <> v_staff_id then
      raise exception 'La cuenta está vinculada a otro perfil de colaborador';
    end if;

    if v_linked_profile.role in ('admin', 'superadmin')
       and exists (
         select 1
         from public.user_profiles up
         where up.id = v_user_id
           and up.store_id is distinct from p_store_id
       ) then
      raise exception 'No se puede cambiar la tienda de una cuenta administrativa desde RR. HH.';
    end if;

    update public.user_profiles up
    set first_name = btrim(p_first_name),
        last_name = btrim(p_last_name),
        email = nullif(lower(btrim(p_email)), ''),
        store_id = p_store_id,
        staff_profile_id = v_staff_id,
        status = case
          when up.role in ('admin', 'superadmin') then up.status
          else v_effective_status
        end,
        role = case
          when up.role in ('admin', 'superadmin') then up.role
          when upper(btrim(p_position)) = 'ENTRENADOR' then 'trainer'::public.app_role
          else 'collaborator'::public.app_role
        end,
        registration_pending = case
          when up.role in ('admin', 'superadmin') then up.registration_pending
          else false
        end,
        updated_at = now()
    where up.id = v_user_id;
  end if;

  return v_staff_id;
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

-- Atomic Vite wrapper: the canonical cession trigger runs inside the same
-- function call, so a failure in either step rolls back both changes.
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
begin
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

  perform public.save_staff_cessation(v_staff_id, p_cessation_date);
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

-- Replace all seven study days atomically.  Collaborator ownership is resolved
-- through the canonical inverse link; admins retain same-store correction and
-- superadmins retain global correction.  Ten blocks/day is a hard abuse guard.
create or replace function private.replace_study_schedule(
  p_staff_id uuid,
  p_schedule jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_caller_id uuid := auth.uid();
  v_caller_role public.app_role := private.current_user_role();
  v_caller_store uuid := private.current_user_store_id();
  v_caller_staff_id uuid := private.current_staff_profile_id();
  v_staff public.staff_profiles%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_lock jsonb;
  v_lock_date_text text;
  v_day_keys constant text[] := array[
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday'
  ];
  v_weekday integer;
  v_day_key text;
  v_day jsonb;
  v_blocks jsonb;
  v_block jsonb;
  v_day_id bigint;
  v_free boolean;
  v_start time;
  v_end time;
begin
  if v_caller_id is null or v_caller_role is null then
    raise exception 'Sesión no válida';
  end if;

  if jsonb_typeof(p_schedule) <> 'object' then
    raise exception 'Horario no válido';
  end if;

  select *
  into v_staff
  from public.staff_profiles sp
  where sp.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  if not (
    v_caller_role = 'superadmin'
    or (v_caller_role = 'admin' and v_caller_store = v_staff.store_id)
    or v_caller_staff_id = v_staff.id
  ) then
    raise exception 'No tienes permiso para editar esta disponibilidad';
  end if;

  if v_caller_role not in ('admin', 'superadmin') then
    if v_staff.sanitary_card_expiry is not null
       and v_today > v_staff.sanitary_card_expiry
       and not coalesce(v_staff.sanitary_card_unlock, false) then
      raise exception 'Carnet sanitario vencido';
    end if;

    select sc.value
    into v_lock
    from public.store_configs sc
    where sc.store_id = v_staff.store_id
      and sc.config_key = 'schedule_lock';

    v_lock_date_text := nullif(v_lock->>'reenableDate', '');
    if coalesce((v_lock->>'restrictionsEnabled')::boolean, false)
       and v_lock_date_text is not null
       and pg_input_is_valid(v_lock_date_text, 'date')
       and v_today <= v_lock_date_text::date then
      raise exception 'Cambios temporalmente bloqueados';
    end if;
  end if;

  for v_weekday in 0..6 loop
    v_day_key := v_day_keys[v_weekday + 1];
    v_day := coalesce(p_schedule->v_day_key, '{}'::jsonb);

    if jsonb_typeof(v_day) <> 'object' then
      raise exception 'Día no válido: %', v_day_key;
    end if;

    v_free := coalesce((v_day->>'free')::boolean, false);
    v_blocks := coalesce(v_day->'blocks', '[]'::jsonb);

    if jsonb_typeof(v_blocks) <> 'array' then
      raise exception 'Bloques no válidos: %', v_day_key;
    end if;

    if jsonb_array_length(v_blocks) > 10 then
      raise exception 'Se permiten como máximo 10 bloques por día: %', v_day_key;
    end if;

    insert into public.study_schedule_days (
      staff_id,
      weekday,
      requests_day_off,
      updated_at
    ) values (
      p_staff_id,
      v_weekday,
      v_free,
      now()
    )
    on conflict (staff_id, weekday) do update
    set requests_day_off = excluded.requests_day_off,
        updated_at = now()
    returning id into v_day_id;

    delete from public.study_schedule_blocks
    where study_day_id = v_day_id;

    if not v_free then
      for v_block in
        select value
        from jsonb_array_elements(v_blocks)
      loop
        if jsonb_typeof(v_block) <> 'object'
           or nullif(v_block->>'start', '') is null
           or nullif(v_block->>'end', '') is null then
          raise exception 'Completa las horas de inicio y fin en %', v_day_key;
        end if;

        v_start := (v_block->>'start')::time;
        v_end := (v_block->>'end')::time;

        if v_start = v_end then
          raise exception 'Inicio y fin no pueden ser iguales en %', v_day_key;
        end if;

        insert into public.study_schedule_blocks (
          study_day_id,
          start_time,
          end_time,
          metadata
        ) values (
          v_day_id,
          v_start,
          v_end,
          v_block
        );
      end loop;
    end if;
  end loop;
end;
$function$;

revoke all on function private.replace_study_schedule(uuid, jsonb) from public, anon;
grant execute on function private.replace_study_schedule(uuid, jsonb) to authenticated;

create or replace function public.save_study_schedule(
  p_staff_id uuid,
  p_schedule jsonb
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.replace_study_schedule(p_staff_id, p_schedule)
$function$;

revoke all on function public.save_study_schedule(uuid, jsonb) from public, anon;
grant execute on function public.save_study_schedule(uuid, jsonb) to authenticated;

-- Edge-only account linking.  The service client passes the authenticated UUID
-- and email, but the database verifies them against auth.users and serializes
-- concurrent claims by locking that row.  A previous staff link may be moved
-- only when it is bidirectional and its cessation is already effective.
create or replace function public.link_existing_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff public.staff_profiles%rowtype;
  v_profile public.user_profiles%rowtype;
  v_previous public.staff_profiles%rowtype;
  v_profile_exists boolean := false;
  v_previous_exists boolean := false;
  v_previous_staff_id uuid;
  v_auth_email text;
  v_normalized_email text := nullif(lower(btrim(p_email)), '');
  v_expected_role public.app_role;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if p_user_id is null or v_normalized_email is null then
    raise exception 'La identidad autenticada es obligatoria';
  end if;

  if p_role not in ('trainer', 'collaborator') then
    raise exception 'Rol de vínculo no permitido';
  end if;

  select nullif(lower(btrim(u.email)), '')
  into v_auth_email
  from auth.users u
  where u.id = p_user_id
  for update;

  if not found or v_auth_email is distinct from v_normalized_email then
    raise exception 'El correo no coincide con la cuenta autenticada';
  end if;

  select *
  into v_profile
  from public.user_profiles up
  where up.id = p_user_id
  for update;
  v_profile_exists := found;

  if v_profile_exists and v_profile.role in ('superadmin', 'admin') then
    raise exception 'Una cuenta administrativa no puede reasignarse como colaborador';
  end if;

  select *
  into v_staff
  from public.staff_profiles sp
  where sp.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  v_expected_role := case
    when upper(btrim(v_staff.position)) = 'ENTRENADOR'
      then 'trainer'::public.app_role
    else 'collaborator'::public.app_role
  end;

  if p_role <> v_expected_role then
    raise exception 'El rol no coincide con la posición del colaborador';
  end if;

  if v_staff.user_id is not null and v_staff.user_id <> p_user_id then
    raise exception 'El colaborador ya está vinculado a otra cuenta';
  end if;

  if v_staff.user_id is null and v_staff.status not in ('pending', 'active') then
    raise exception 'El colaborador ya no está disponible';
  end if;

  if v_staff.cessation_date is not null and v_staff.cessation_date < v_today then
    raise exception 'El perfil de destino tiene un cese efectivo';
  end if;

  if nullif(btrim(v_staff.email), '') is not null
     and lower(btrim(v_staff.email)) <> v_normalized_email then
    raise exception 'El correo no coincide con el perfil del colaborador';
  end if;

  perform 1
  from public.user_profiles up
  where up.staff_profile_id = p_staff_id
    and up.id <> p_user_id
  for update;

  if found then
    raise exception 'El colaborador ya está reclamado por otra cuenta';
  end if;

  select *
  into v_previous
  from public.staff_profiles sp
  where sp.user_id = p_user_id
    and sp.id <> p_staff_id
  for update;
  v_previous_exists := found;

  if v_profile_exists
     and v_profile.staff_profile_id is not null
     and v_profile.staff_profile_id <> p_staff_id then
    if not v_previous_exists or v_previous.id <> v_profile.staff_profile_id then
      raise exception 'El enlace anterior de la cuenta es inconsistente';
    end if;
  end if;

  if v_previous_exists then
    if not v_profile_exists
       or v_profile.staff_profile_id is distinct from v_previous.id then
      raise exception 'El enlace inverso anterior de la cuenta es inconsistente';
    end if;

    if v_previous.cessation_date is null
       or v_previous.cessation_date >= v_today then
      raise exception 'La cuenta ya pertenece a un colaborador vigente';
    end if;

    v_previous_staff_id := v_previous.id;

    update public.staff_profiles sp
    set user_id = null,
        updated_at = now()
    where sp.id = v_previous.id
      and sp.user_id = p_user_id;
  end if;

  update public.staff_profiles sp
  set user_id = p_user_id,
      email = v_normalized_email,
      status = 'active',
      linked_at = now(),
      updated_at = now()
  where sp.id = p_staff_id
    and (sp.user_id is null or sp.user_id = p_user_id);

  if not found then
    raise exception 'El colaborador cambió mientras se procesaba el vínculo';
  end if;

  insert into public.user_profiles (
    id,
    email,
    first_name,
    last_name,
    role,
    status,
    store_id,
    staff_profile_id,
    registration_pending,
    updated_at
  ) values (
    p_user_id,
    v_normalized_email,
    v_staff.first_name,
    v_staff.last_name,
    p_role,
    'active',
    v_staff.store_id,
    v_staff.id,
    false,
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      role = excluded.role,
      status = excluded.status,
      store_id = excluded.store_id,
      staff_profile_id = excluded.staff_profile_id,
      registration_pending = false,
      updated_at = now();

  return v_previous_staff_id;
end;
$function$;

create or replace function public.link_invited_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.link_existing_staff_account(
    p_staff_id,
    p_user_id,
    p_email,
    p_role
  );
end;
$function$;

create or replace function public.claim_staff_account(
  p_staff_id uuid,
  p_user_id uuid,
  p_email text,
  p_dni text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff public.staff_profiles%rowtype;
  v_role public.app_role;
  v_normalized_dni text := regexp_replace(coalesce(p_dni, ''), '[^0-9]', '', 'g');
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if p_user_id is null or nullif(lower(btrim(p_email)), '') is null then
    raise exception 'La identidad autenticada es obligatoria';
  end if;

  if length(v_normalized_dni) < 6 or length(v_normalized_dni) > 15 then
    raise exception 'DNI inválido';
  end if;

  select *
  into v_staff
  from public.staff_profiles sp
  where sp.id = p_staff_id
  for update;

  if not found then
    raise exception 'Colaborador no encontrado';
  end if;

  if v_staff.user_id is null and v_staff.status <> 'pending' then
    raise exception 'El colaborador ya no está disponible';
  end if;

  if v_staff.user_id is not null and v_staff.user_id <> p_user_id then
    raise exception 'El colaborador ya está vinculado';
  end if;

  if v_staff.cessation_date is not null and v_staff.cessation_date < v_today then
    raise exception 'El colaborador ya no está vigente';
  end if;

  if regexp_replace(coalesce(v_staff.dni, ''), '[^0-9]', '', 'g') <> v_normalized_dni then
    raise exception 'El DNI no coincide';
  end if;

  if nullif(btrim(v_staff.email), '') is not null
     and lower(btrim(v_staff.email)) <> lower(btrim(p_email)) then
    raise exception 'El correo no coincide';
  end if;

  perform 1
  from public.staff_profiles other
  where other.id <> v_staff.id
    and other.store_id = v_staff.store_id
    and other.status = 'pending'
    and other.user_id is null
    and (
      other.cessation_date is null
      or other.cessation_date >= v_today
    )
    and regexp_replace(coalesce(other.dni, ''), '[^0-9]', '', 'g') = v_normalized_dni;

  if found then
    raise exception 'El DNI coincide con más de un colaborador disponible';
  end if;

  v_role := case
    when upper(btrim(v_staff.position)) = 'ENTRENADOR'
      then 'trainer'::public.app_role
    else 'collaborator'::public.app_role
  end;

  return public.link_existing_staff_account(
    p_staff_id,
    p_user_id,
    lower(btrim(p_email)),
    v_role
  );
end;
$function$;

revoke all on function public.link_existing_staff_account(uuid, uuid, text, public.app_role)
  from public, anon, authenticated;
revoke all on function public.link_invited_staff_account(uuid, uuid, text, public.app_role)
  from public, anon, authenticated;
revoke all on function public.claim_staff_account(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.link_existing_staff_account(uuid, uuid, text, public.app_role)
  to service_role;
grant execute on function public.link_invited_staff_account(uuid, uuid, text, public.app_role)
  to service_role;
grant execute on function public.claim_staff_account(uuid, uuid, text, text)
  to service_role;

-- Self-service profile edits resolve ownership through the canonical helper.
-- Certifications are intentionally excluded: only the evaluated/admin/trainer
-- skill paths may change staff_skills and its projection.
create or replace function public.update_own_staff_profile(
  p_birth_date date default null,
  p_position_abilities jsonb default null,
  p_pending_holidays jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_staff_id uuid := private.current_staff_profile_id();
begin
  if v_staff_id is null then
    raise exception 'La cuenta no tiene un colaborador vigente vinculado';
  end if;

  if p_position_abilities is not null then
    raise exception 'Las habilidades solo pueden cambiarse mediante una evaluación o por un responsable autorizado';
  end if;

  if p_pending_holidays is not null
     and jsonb_typeof(p_pending_holidays) <> 'array' then
    raise exception 'Los feriados pendientes deben ser una lista';
  end if;

  if p_pending_holidays is not null
     and jsonb_array_length(p_pending_holidays) > 100 then
    raise exception 'Se permiten como máximo 100 feriados pendientes';
  end if;

  update public.staff_profiles sp
  set birth_date = coalesce(p_birth_date, sp.birth_date),
      pending_holidays = coalesce(p_pending_holidays, sp.pending_holidays),
      updated_at = now()
  where sp.id = v_staff_id;

  return found;
end;
$function$;

revoke all on function public.update_own_staff_profile(date, jsonb, jsonb) from public, anon;
grant execute on function public.update_own_staff_profile(date, jsonb, jsonb) to authenticated;

-- Explicitly preserve every RPC contract invoked by the two clients.  The
-- sales batch RPC is created and granted by the immediately following sales
-- repair migration, so it is intentionally not referenced before it exists.
do $rpc_grants$
begin
  if to_regprocedure('public.save_weekly_schedules(date,jsonb)') is not null then
    grant execute on function public.save_weekly_schedules(date, jsonb) to authenticated;
  end if;

  if to_regprocedure(
    'public.save_staff_cessation(uuid,date,text,text,text,text,numeric,numeric,text,numeric,numeric,numeric,numeric)'
  ) is not null then
    grant execute on function public.save_staff_cessation(
      uuid, date, text, text, text, text, numeric, numeric, text,
      numeric, numeric, numeric, numeric
    ) to authenticated;
  end if;

  if to_regprocedure('public.consume_rate_limit(text,integer,integer)') is not null then
    revoke all on function public.consume_rate_limit(text, integer, integer)
      from public, anon, authenticated;
    grant execute on function public.consume_rate_limit(text, integer, integer)
      to service_role;
  end if;
end;
$rpc_grants$;
