create schema if not exists private;

create or replace function private.sanitize_legacy_identity_payload(payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb;
  item record;
begin
  if payload is null then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(payload) = 'object' then
    result := '{}'::jsonb;
    for item in select key, value from jsonb_each(payload)
    loop
      if item.key in (
        'id', 'uid', 'staffId', 'storeId', 'userId', 'trainerId',
        'collaboratorId', 'staffProfileId', 'firestore_id', 'firebase_uid',
        'firestoreId', 'firebaseUid', 'firestore_path', 'firebase_store_id',
        'merged_firebase_uids'
      ) then
        continue;
      end if;
      result := result || jsonb_build_object(
        item.key,
        private.sanitize_legacy_identity_payload(item.value)
      );
    end loop;
    return result;
  end if;
  if jsonb_typeof(payload) = 'array' then
    select coalesce(
      jsonb_agg(private.sanitize_legacy_identity_payload(value)),
      '[]'::jsonb
    )
    into result
    from jsonb_array_elements(payload);
    return result;
  end if;
  return payload;
end;
$$;

create or replace function private.sanitize_legacy_data_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.legacy_data := private.sanitize_legacy_identity_payload(new.legacy_data);
  return new;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'legacy_data'
  loop
    execute format(
      'drop trigger if exists sanitize_legacy_identity_before_write on public.%I',
      target.table_name
    );
    execute format(
      'create trigger sanitize_legacy_identity_before_write before insert or update of legacy_data on public.%I for each row execute function private.sanitize_legacy_data_before_write()',
      target.table_name
    );
  end loop;
end;
$$;

alter table public.cessations add constraint cessations_no_new_external_id check (firestore_id is null) not valid;
alter table public.extra_hours add constraint extra_hours_no_new_external_id check (firestore_id is null) not valid;
alter table public.sales_daily_history add constraint sales_daily_history_no_new_external_id check (firestore_id is null) not valid;
alter table public.sales_month_configs add constraint sales_month_configs_no_new_external_id check (firestore_id is null) not valid;
alter table public.sales_projection_templates add constraint sales_projection_templates_no_new_external_id check (firestore_id is null) not valid;
alter table public.sales_projections add constraint sales_projections_no_new_external_id check (firestore_id is null) not valid;
alter table public.schedule_requests add constraint schedule_requests_no_new_external_id check (firestore_id is null) not valid;
alter table public.schedule_weeks add constraint schedule_weeks_no_new_external_id check (firestore_id is null) not valid;
alter table public.staff_profiles add constraint staff_profiles_no_new_external_id check (firestore_id is null) not valid;
alter table public.store_configs add constraint store_configs_no_new_external_id check (firestore_id is null) not valid;
alter table public.store_positioning_requirements add constraint store_positioning_requirements_no_new_external_id check (firestore_id is null) not valid;
alter table public.store_positions add constraint store_positions_no_new_external_id check (firestore_id is null) not valid;
alter table public.stores add constraint stores_no_new_external_id check (firestore_id is null) not valid;
alter table public.training_evaluations add constraint training_evaluations_no_new_external_id check (firestore_id is null) not valid;
alter table public.user_profiles add constraint user_profiles_no_new_external_id check (firebase_uid is null) not valid;
alter table public.worked_holidays add constraint worked_holidays_no_new_external_id check (firestore_id is null) not valid;

revoke all on function private.sanitize_legacy_identity_payload(jsonb) from public, anon, authenticated;
revoke all on function private.sanitize_legacy_data_before_write() from public, anon, authenticated;
