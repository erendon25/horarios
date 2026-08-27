\set ON_ERROR_STOP on

select current_database() as database_name, now() as verified_at;

select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

select 'stores' as entity, count(*) as rows from public.stores
union all select 'user_profiles', count(*) from public.user_profiles
union all select 'staff_profiles', count(*) from public.staff_profiles
union all select 'schedule_weeks', count(*) from public.schedule_weeks
union all select 'schedule_shifts', count(*) from public.schedule_shifts
union all select 'study_schedule_days', count(*) from public.study_schedule_days
union all select 'extra_hours', count(*) from public.extra_hours
union all select 'schedule_requests', count(*) from public.schedule_requests
union all select 'training_evaluations', count(*) from public.training_evaluations
union all select 'sales_daily_history', count(*) from public.sales_daily_history
union all select 'sales_hourly_history', count(*) from public.sales_hourly_history
order by entity;

do $$
begin
  if exists (
    select 1 from public.staff_profiles
    where store_id is null or first_name is null or last_name is null
  ) then raise exception 'invalid staff profile found'; end if;

  if exists (
    select 1 from public.schedule_shifts shift
    left join public.schedule_weeks week on week.id = shift.schedule_week_id
    where week.id is null
  ) then raise exception 'orphan schedule shift found'; end if;

  if exists (
    select 1
    from public.user_profiles account
    where account.role in ('trainer', 'collaborator')
      and account.status = 'active'
      and not account.registration_pending
      and not exists (
        select 1
        from public.staff_profiles staff
        join public.stores store on store.id = staff.store_id and store.is_active
        where staff.id = account.staff_profile_id
          and staff.user_id = account.id
          and staff.store_id = account.store_id
          and (
            staff.cessation_date is null
            or staff.cessation_date >= (now() at time zone 'America/Lima')::date
          )
          and not (
            staff.is_trainee
            and staff.training_end_date is not null
            and staff.training_end_date < (now() at time zone 'America/Lima')::date
          )
      )
      -- A completed trainee episode intentionally keeps its inverse Auth link
      -- available for a later rehire, but current_staff_profile_id() removes
      -- every operational permission from the day after training ends.
      and not exists (
        select 1
        from public.staff_profiles staff
        join public.stores store on store.id = staff.store_id and store.is_active
        where staff.id = account.staff_profile_id
          and staff.user_id = account.id
          and staff.store_id = account.store_id
          and staff.is_trainee
          and staff.training_end_date is not null
          and staff.training_end_date < (now() at time zone 'America/Lima')::date
      )
  ) then raise exception 'active collaborator account without a canonical current staff link'; end if;

  if not exists (
    select 1
    from pg_proc function
    join pg_namespace schema on schema.oid = function.pronamespace
    where schema.nspname = 'private'
      and function.proname = 'current_staff_profile_id'
      and pg_get_functiondef(function.oid) ilike '%training_end_date%'
      and pg_get_functiondef(function.oid) ilike '%America/Lima%'
  ) then raise exception 'current staff authorization does not expire completed training episodes'; end if;

  if exists (
    select 1
    from public.schedule_weeks entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null or entity.store_id is distinct from staff.store_id
  ) then raise exception 'work schedule without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.schedule_requests entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null
       or entity.store_id is distinct from staff.store_id
  ) then raise exception 'schedule request without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.worked_holidays entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null
       or entity.store_id is distinct from staff.store_id
  ) then raise exception 'worked holiday without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.cessations entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null or entity.store_id is distinct from staff.store_id
  ) then raise exception 'cessation without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.staff_profiles staff
    where staff.cessation_date is not null
      and not exists (
        select 1
        from public.cessations cessation
        where cessation.staff_id = staff.id
          and cessation.store_id = staff.store_id
          and cessation.cessation_date = staff.cessation_date
          and not cessation.is_modality_change
      )
  ) then raise exception 'staff cessation date without canonical cessation history'; end if;

  if exists (
    select 1
    from public.extra_hours entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where (
      staff.id is null
      or entity.store_id is null
      or entity.store_id is distinct from staff.store_id
    )
      and not exists (
        select 1
        from private.staff_linkage_issues issue
        where issue.entity = 'extra_hours'
          and issue.record_key = entity.id::text
          and issue.issue_code = 'missing_or_inconsistent_staff_store_link'
          and issue.resolved_at is null
      )
  ) then raise exception 'unquarantined extra-hours row without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.training_evaluations entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null or entity.store_id is distinct from staff.store_id
  ) then raise exception 'training evaluation without a consistent staff/store link'; end if;

  if exists (
    select 1
    from public.study_schedule_days entity
    left join public.staff_profiles staff on staff.id = entity.staff_id
    where staff.id is null
  ) then raise exception 'study schedule without a staff link'; end if;

  if exists (
    select 1
    from public.staff_skills skill
    left join public.staff_profiles staff on staff.id = skill.staff_id
    left join public.store_positions position on position.id = skill.store_position_id
    where staff.id is null
       or (position.id is not null and position.store_id is distinct from staff.store_id)
  ) then raise exception 'skill without a consistent staff/store-position link'; end if;

  if exists (
    select 1
    from public.staff_profiles staff
    where jsonb_typeof(staff.pending_holidays) <> 'array'
       or jsonb_array_length(staff.pending_holidays) <> 0
  ) then raise exception 'legacy pending holidays remain outside worked_holidays'; end if;

  if not has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'CREATE')
     or has_schema_privilege('anon', 'private', 'USAGE')
     or not has_function_privilege(
       'authenticated',
       'public.save_study_schedule(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_study_schedule(uuid,jsonb)',
       'EXECUTE'
     )
  then raise exception 'study schedule privilege contract is broken'; end if;

  if not has_function_privilege(
       'authenticated',
       'public.save_weekly_schedules(date,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_weekly_schedules(date,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'private.replace_weekly_schedules(date,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.replace_weekly_schedules_internal(date,jsonb)',
       'EXECUTE'
     )
     or not exists (
       select 1
       from pg_proc function
       join pg_namespace schema on schema.oid = function.pronamespace
       where schema.nspname = 'private'
         and function.proname = 'replace_weekly_schedules'
         and pg_get_function_identity_arguments(function.oid) = 'p_week_start date, p_changes jsonb'
         and pg_get_functiondef(function.oid) like '%private.current_user_role()%'
         and pg_get_functiondef(function.oid) like '%private.current_user_store_id()%'
         and pg_get_functiondef(function.oid) ilike '%v_role is null%'
     )
  then raise exception 'weekly schedule authorization contract is broken'; end if;

  if not has_function_privilege(
       'service_role',
       'public.claim_staff_account(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.claim_staff_account(uuid,uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.claim_staff_account(uuid,uuid,text,text)',
       'EXECUTE'
     )
  then raise exception 'staff-account claim privilege contract is broken'; end if;

  if has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE')
     or has_table_privilege('authenticated', 'public.staff_profiles', 'INSERT')
     or has_table_privilege('authenticated', 'public.staff_profiles', 'UPDATE')
     or not has_function_privilege(
       'authenticated',
       'public.save_staff_profile(uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_staff_profile(uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.mark_staff_import_state(uuid[],boolean,text,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.import_geovictoria_staff_profile(uuid,text,text,text,text,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.import_geovictoria_staff_profile(uuid,text,text,text,text,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.save_staff_cessation_internal(uuid,date,text,text,text,text,numeric,numeric,text,numeric,numeric,numeric,numeric)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.save_staff_profile_internal(uuid,uuid,text,text,text,text,text,date,text,text,public.record_status,date,date,boolean,boolean,date,date,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.replace_staff_skills_internal(uuid,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'private.finish_staff_training_internal(uuid,date)',
       'EXECUTE'
     )
  then raise exception 'staff identity write boundary is broken'; end if;

  if exists (
    select 1
    from public.staff_profiles staff
    where (staff.import_source is null and (
             staff.import_source_file is not null
             or staff.imported_at is not null
           ))
       or (
         lower(btrim(staff.import_source)) = 'geovictoria'
         and staff.imported_at is null
       )
  ) then raise exception 'staff import provenance is incomplete or inconsistent'; end if;

  if not exists (
    select 1
    from pg_proc function
    join pg_namespace schema on schema.oid = function.pronamespace
    where schema.nspname = 'public'
      and function.proname = 'import_geovictoria_staff_profile'
      and pg_get_function_identity_arguments(function.oid)
        = 'p_store_id uuid, p_first_name text, p_last_name text, p_dni text, p_email text, p_join_date date, p_source_file text'
      and pg_get_functiondef(function.oid) not ilike '%staff.status%'
      and pg_get_functiondef(function.oid) ilike '%cessation_date%'
      and pg_get_functiondef(function.oid) ilike '%training_end_date%'
  ) then raise exception 'GeoVictoria import does not preserve inactive identities without an effective end date'; end if;

  if not has_function_privilege(
       'authenticated',
       'public.save_sales_configuration(uuid,date,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_sales_configuration(uuid,date,jsonb,jsonb,jsonb,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_sales_history_batch(uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.save_sales_history_batch(uuid,jsonb)',
       'EXECUTE'
     )
  then raise exception 'atomic sales configuration privilege contract is broken'; end if;

  if exists (
    select 1
    from (values
      ('extra_hours', 'extra_hours_enforce_staff_store'),
      ('training_evaluations', 'training_evaluations_enforce_staff_store'),
      ('staff_profiles', 'staff_profiles_prevent_store_drift'),
      ('staff_profiles', 'staff_profiles_enforce_linked_identity'),
      ('staff_profiles', 'staff_profiles_protect_effective_cessation'),
      ('staff_profiles', 'staff_profiles_protect_effective_training'),
      ('staff_profiles', 'staff_profiles_enforce_empty_pending_holidays'),
      ('cessations', 'cessations_protect_effective_history'),
      ('training_evaluations', 'training_evaluations_protect_completion'),
      ('training_evaluations', 'training_evaluations_validate_completion'),
      ('training_evaluations', 'training_evaluations_apply_completion')
    ) as required(table_name, trigger_name)
    where not exists (
      select 1
      from pg_trigger trigger
      join pg_class relation on relation.oid = trigger.tgrelid
      join pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public'
        and relation.relname = required.table_name
        and trigger.tgname = required.trigger_name
        and not trigger.tgisinternal
        and trigger.tgenabled <> 'D'
    )
  ) then raise exception 'required collaborator-integrity trigger is missing or disabled'; end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'training_evaluations'
      and policyname = 'training_evaluations_read'
  ) or exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'training_evaluations'
      and policyname = 'training_evaluations_read'
      and coalesce(qual, '') ilike '%trainer_id%'
  ) then raise exception 'training evaluation read policy bypasses canonical identity'; end if;

  if (select count(*) from private.training_evaluation_templates) <> 9
     or exists (
       select 1
       from (values
         ('service', 'SERVICIO', 21),
         ('service', 'DESPACHO', 20),
         ('service', 'DELIVERY', 23),
         ('service', 'TRAFICO', 21),
         ('production', 'PREPARACION', 28),
         ('production', 'SHEETOUT', 44),
         ('production', 'VESTIDO', 23),
         ('production', 'LANDING', 44),
         ('production', 'LAVADO', 15)
       ) as expected(area, station_code, criterion_count)
       left join private.training_evaluation_templates template
         on template.area = expected.area
        and template.station_code = expected.station_code
       where cardinality(template.expected_response_keys) is distinct from expected.criterion_count
     )
  then raise exception 'training evaluation template catalog is incomplete'; end if;

  if exists (
    select 1
    from public.training_evaluations evaluation
    where (evaluation.completion_verified_at is null)
          <> (evaluation.completion_version is null)
       or (
         evaluation.completion_verified_at is not null
         and (
           evaluation.status <> 'completed'
           or evaluation.completion_version is distinct from 1
         )
       )
  ) then raise exception 'training completion verification metadata is inconsistent'; end if;

  if exists (
    select 1
    from public.training_evaluations evaluation
    where evaluation.status = 'completed'
      and evaluation.completion_verified_at is null
      and not exists (
        select 1
        from private.training_evidence_issues issue
        where issue.evaluation_id = evaluation.id
          and issue.issue_code = 'legacy_unverified_completion'
          and issue.resolved_at is null
      )
  ) then raise exception 'an unverified legacy completion is missing its audit issue'; end if;

  if exists (
    select 1
    from public.training_evaluations evaluation
    where evaluation.status = 'completed'
      and evaluation.completion_verified_at is not null
      and (
        evaluation.collaborator_signature_path is null
        or evaluation.trainer_signature_path is null
        or evaluation.collaborator_signature_path !~* (
          '^' || evaluation.store_id::text || '/' || evaluation.id::text
          || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-collaborator[.]png$'
        )
        or evaluation.trainer_signature_path !~* (
          '^' || evaluation.store_id::text || '/' || evaluation.id::text
          || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-trainer[.]png$'
        )
        or not exists (
          select 1
          from storage.objects object
          where object.bucket_id = 'training-signatures'
            and object.name = evaluation.collaborator_signature_path
        )
        or not exists (
          select 1
          from storage.objects object
          where object.bucket_id = 'training-signatures'
            and object.name = evaluation.trainer_signature_path
        )
      )
  ) then raise exception 'a verified training completion has invalid evidence'; end if;

  if exists (
    with ranked_station_scores as (
      select
        evaluation.staff_id,
        btrim(evaluation.station_code) as station_code,
        evaluation.score,
        row_number() over (
          partition by evaluation.staff_id, btrim(evaluation.station_code)
          order by evaluation.evaluation_date desc, evaluation.id desc
        ) as rank
      from public.training_evaluations evaluation
      where evaluation.status = 'completed'
        and evaluation.completion_verified_at is not null
        and evaluation.completion_version = 1
        and nullif(btrim(evaluation.station_code), '') is not null
        and evaluation.score is not null
    ), score_maps as (
      select
        score.staff_id,
        jsonb_object_agg(score.station_code, to_jsonb(score.score)) as training_scores
      from ranked_station_scores score
      where score.rank = 1
      group by score.staff_id
    ), latest_evaluations as (
      select distinct on (evaluation.staff_id)
        evaluation.staff_id,
        evaluation.evaluation_date,
        evaluation.score,
        nullif(btrim(evaluation.station_code), '') as station_code
      from public.training_evaluations evaluation
      where evaluation.status = 'completed'
        and evaluation.completion_verified_at is not null
        and evaluation.completion_version = 1
      order by evaluation.staff_id, evaluation.evaluation_date desc, evaluation.id desc
    )
    select 1
    from public.staff_profiles staff
    left join score_maps score on score.staff_id = staff.id
    left join latest_evaluations latest on latest.staff_id = staff.id
    where (
      staff.training_scores,
      staff.last_evaluation_date,
      staff.last_evaluation_score,
      staff.last_station_evaluated
    ) is distinct from (
      coalesce(score.training_scores, '{}'::jsonb),
      latest.evaluation_date,
      latest.score,
      latest.station_code
    )
  ) then raise exception 'staff training summaries include unverified or stale evaluations'; end if;

  if exists (
       select 1
       from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'training_signatures_update'
     )
     or not exists (
       select 1
       from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname = 'training_signatures_delete'
         and cmd = 'DELETE'
     )
  then raise exception 'training signature immutability policy is broken'; end if;

  if exists (
    select path
    from (
      select collaborator_signature_path as path
      from public.training_evaluations
      where status = 'completed'
      union all
      select trainer_signature_path as path
      from public.training_evaluations
      where status = 'completed'
    ) signatures
    where path is not null
    group by path
    having count(*) > 1
  ) then raise exception 'a completed training signature was reused'; end if;

  if exists (
    select 1
    from public.sales_daily_history daily
    left join (
      select
        hourly.sales_daily_id,
        sum(hourly.sales_amount) as sales_amount,
        sum(hourly.transactions) as transactions
      from public.sales_hourly_history hourly
      group by hourly.sales_daily_id
    ) totals on totals.sales_daily_id = daily.id
    where coalesce(totals.sales_amount, 0) <> daily.sales_amount
       or coalesce(totals.transactions, 0) <> daily.transactions
  ) then raise exception 'hourly sales totals do not match daily history'; end if;
end;
$$;

select entity, issue_code, count(*) as unresolved_rows
from private.staff_linkage_issues
where resolved_at is null
group by entity, issue_code
order by entity, issue_code;

select issue_code, count(*) as unresolved_rows
from private.training_evidence_issues
where resolved_at is null
group by issue_code
order by issue_code;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select bucket_id, count(*) as object_count
from storage.objects
group by bucket_id
order by bucket_id;
