-- A manager-reviewed, expiring allowlist. No legacy passwords or tokens are stored.
create table private.approved_legacy_staff_logins (
  approval_id uuid not null default gen_random_uuid() unique,
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  firebase_uid text not null unique,
  staff_id uuid not null unique references public.staff_profiles(id) on delete cascade,
  expected_store_id uuid not null references public.stores(id),
  expected_previous_user_id uuid,
  expected_staff_email text,
  enabled boolean not null default true,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  completed_user_id uuid,
  completed_at timestamptz,
  previous_account_snapshot jsonb
);
alter table private.approved_legacy_staff_logins enable row level security;
create index approved_legacy_staff_logins_store_idx on private.approved_legacy_staff_logins(expected_store_id);
revoke all on private.approved_legacy_staff_logins from public, anon, authenticated;
grant select, insert, update on private.approved_legacy_staff_logins to service_role;

create function private.prepare_approved_legacy_staff_login(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a private.approved_legacy_staff_logins%rowtype;
  s public.staff_profiles%rowtype;
  u auth.users%rowtype;
  previous public.user_profiles%rowtype;
  today date := (now() at time zone 'America/Lima')::date;
begin
  select * into a from private.approved_legacy_staff_logins
    where email = lower(btrim(p_email)) and enabled and expires_at > now() and completed_at is null;
  if not found then return null; end if;
  select * into s from public.staff_profiles where id = a.staff_id;
  if not found or s.status not in ('active', 'pending')
    or s.store_id is distinct from a.expected_store_id
    or s.user_id is distinct from a.expected_previous_user_id
    or nullif(lower(btrim(s.email)), '') is distinct from nullif(lower(btrim(a.expected_staff_email)), '')
    or upper(btrim(coalesce(s.position, ''))) <> 'COLABORADOR'
    or (s.cessation_date is not null and s.cessation_date < today)
    or (s.is_trainee and s.training_end_date is not null and s.training_end_date < today)
    or not exists (select 1 from public.stores where id = s.store_id and is_active)
    then return null; end if;
  if s.user_id is not null then
    select * into previous from public.user_profiles where id = s.user_id;
    if not found or previous.role <> 'collaborator'
      or previous.staff_profile_id is distinct from s.id
      or previous.store_id is distinct from s.store_id then return null; end if;
  end if;
  select * into u from auth.users where lower(btrim(email)) = a.email;
  if found then
    -- Only resume an account created by this server for this exact approval.
    if u.deleted_at is not null or u.banned_until > now()
      or (u.raw_app_meta_data->>'legacy_staff_recovery_id') is distinct from a.approval_id::text
      or (u.raw_app_meta_data->>'firebase_uid') is distinct from a.firebase_uid
      or exists (select 1 from public.staff_profiles where user_id = u.id and id <> s.id)
      or exists (select 1 from public.user_profiles where id = u.id and
        (role <> 'collaborator' or (staff_profile_id is not null and staff_profile_id <> s.id)))
      then return null; end if;
  end if;
  return jsonb_build_object('email', a.email, 'firebase_uid', a.firebase_uid,
    'staff_id', a.staff_id, 'approval_id', a.approval_id, 'user_id', u.id);
end $$;

create function private.complete_approved_legacy_staff_login(p_email text, p_user_id uuid, p_firebase_uid text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  a private.approved_legacy_staff_logins%rowtype;
  s public.staff_profiles%rowtype;
  u auth.users%rowtype;
  previous public.user_profiles%rowtype;
  today date := (now() at time zone 'America/Lima')::date;
begin
  select * into a from private.approved_legacy_staff_logins
    where email = lower(btrim(p_email)) and enabled and expires_at > now() for update;
  if not found or a.firebase_uid is distinct from p_firebase_uid then return false; end if;
  select * into u from auth.users where id = p_user_id for update;
  if not found or lower(btrim(u.email)) is distinct from a.email
    or u.deleted_at is not null or u.banned_until > now()
    or (u.raw_app_meta_data->>'legacy_staff_recovery_id') is distinct from a.approval_id::text
    or (u.raw_app_meta_data->>'firebase_uid') is distinct from a.firebase_uid
    then return false; end if;
  select * into s from public.staff_profiles where id = a.staff_id for update;
  if not found or s.status not in ('active', 'pending') or s.store_id is distinct from a.expected_store_id
    or upper(btrim(coalesce(s.position, ''))) <> 'COLABORADOR'
    or (s.cessation_date is not null and s.cessation_date < today)
    or (s.is_trainee and s.training_end_date is not null and s.training_end_date < today)
    or not exists (select 1 from public.stores where id = s.store_id and is_active)
    then return false; end if;
  if a.completed_at is not null then
    return a.completed_user_id = p_user_id and s.user_id = p_user_id
      and exists (select 1 from public.user_profiles where id = p_user_id
        and role = 'collaborator' and status = 'active' and not registration_pending
        and staff_profile_id = s.id and store_id = s.store_id);
  end if;
  if s.user_id is distinct from a.expected_previous_user_id
    or nullif(lower(btrim(s.email)), '') is distinct from nullif(lower(btrim(a.expected_staff_email)), '')
    or exists (select 1 from public.staff_profiles where user_id = p_user_id and id <> s.id)
    then return false; end if;
  perform 1 from public.user_profiles where id = p_user_id for update;
  if exists (select 1 from public.user_profiles where id = p_user_id
    and (role <> 'collaborator' or (staff_profile_id is not null and staff_profile_id <> s.id)))
    then return false; end if;
  if s.user_id is not null then
    select * into previous from public.user_profiles where id = s.user_id for update;
    if not found or previous.role <> 'collaborator'
      or previous.staff_profile_id is distinct from s.id
      or previous.store_id is distinct from s.store_id then return false; end if;
    -- Keep the previous Auth account intact, but remove its incorrect staff access.
    update public.user_profiles set staff_profile_id = null, store_id = null,
      registration_pending = true, status = 'inactive', updated_at = now() where id = previous.id;
  end if;
  insert into public.user_profiles(id, email, first_name, last_name, role, status,
    store_id, staff_profile_id, registration_pending, updated_at)
  values (p_user_id, a.email, s.first_name, s.last_name, 'collaborator', 'active', s.store_id, s.id, false, now())
  on conflict (id) do update set email = excluded.email, first_name = excluded.first_name,
    last_name = excluded.last_name, role = excluded.role, status = excluded.status,
    store_id = excluded.store_id, staff_profile_id = excluded.staff_profile_id,
    registration_pending = false, updated_at = now();
  update public.staff_profiles set user_id = p_user_id, email = a.email,
    status = 'active', linked_at = now(), updated_at = now() where id = s.id;
  update private.approved_legacy_staff_logins set completed_user_id = p_user_id, completed_at = now(),
    previous_account_snapshot = case when previous.id is null then null else jsonb_build_object(
      'id', previous.id, 'email', previous.email, 'role', previous.role, 'status', previous.status,
      'store_id', previous.store_id, 'staff_profile_id', previous.staff_profile_id) end
    where email = a.email;
  return true;
end $$;

create function public.prepare_approved_legacy_staff_login(p_email text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.prepare_approved_legacy_staff_login(p_email);
$$;
create function public.complete_approved_legacy_staff_login(p_email text, p_user_id uuid, p_firebase_uid text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.complete_approved_legacy_staff_login(p_email, p_user_id, p_firebase_uid);
$$;
revoke all on function private.prepare_approved_legacy_staff_login(text),
  private.complete_approved_legacy_staff_login(text,uuid,text),
  public.prepare_approved_legacy_staff_login(text),
  public.complete_approved_legacy_staff_login(text,uuid,text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.prepare_approved_legacy_staff_login(text),
  private.complete_approved_legacy_staff_login(text,uuid,text),
  public.prepare_approved_legacy_staff_login(text),
  public.complete_approved_legacy_staff_login(text,uuid,text) to service_role;
notify pgrst, 'reload schema';
