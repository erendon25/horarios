-- Keep the browser-facing RPC contract in `public`, but move every privileged
-- implementation to the unexposed `private` schema. The public functions are
-- SECURITY INVOKER wrappers, so PostgREST no longer exposes definer functions.

alter function public.clear_staff_pending_holidays(uuid) set schema private;
alter function public.finish_staff_training(uuid, date) set schema private;
alter function public.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) set schema private;
alter function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) set schema private;
alter function public.replace_staff_skills(uuid, text[]) set schema private;
alter function public.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) set schema private;
alter function public.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) set schema private;
alter function public.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) set schema private;
alter function public.update_own_staff_profile(date, jsonb, jsonb) set schema private;

create function public.clear_staff_pending_holidays(p_staff_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.clear_staff_pending_holidays(p_staff_id);
$function$;

create function public.finish_staff_training(
  p_staff_id uuid,
  p_training_end_date date
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.finish_staff_training(p_staff_id, p_training_end_date);
$function$;

create function public.import_geovictoria_staff_profile(
  p_store_id uuid,
  p_first_name text,
  p_last_name text,
  p_dni text,
  p_email text default null::text,
  p_join_date date default null::date,
  p_source_file text default null::text
)
returns table(staff_id uuid, created boolean)
language sql
security invoker
set search_path = ''
as $function$
  select *
  from private.import_geovictoria_staff_profile(
    p_store_id,
    p_first_name,
    p_last_name,
    p_dni,
    p_email,
    p_join_date,
    p_source_file
  );
$function$;

create function public.publish_suggestive_sales_goals(
  p_store_id uuid,
  p_month_start date,
  p_rows jsonb,
  p_targets jsonb
)
returns integer
language sql
security invoker
set search_path = ''
as $function$
  select private.publish_suggestive_sales_goals(
    p_store_id,
    p_month_start,
    p_rows,
    p_targets
  );
$function$;

create function public.replace_staff_skills(
  p_staff_id uuid,
  p_skill_codes text[]
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.replace_staff_skills(p_staff_id, p_skill_codes);
$function$;

create function public.save_staff_cessation(
  p_staff_id uuid,
  p_cessation_date date,
  p_performance text default null::text,
  p_cessation_reason text default null::text,
  p_real_reason text default null::text,
  p_store_comment text default null::text,
  p_medical_leave_days numeric default null::numeric,
  p_absences numeric default null::numeric,
  p_tardiness text default null::text,
  p_night_hours numeric default null::numeric,
  p_extra_hours numeric default null::numeric,
  p_holidays numeric default null::numeric,
  p_discounts numeric default null::numeric
)
returns void
language sql
security invoker
set search_path = ''
as $function$
  select private.save_staff_cessation(
    p_staff_id,
    p_cessation_date,
    p_performance,
    p_cessation_reason,
    p_real_reason,
    p_store_comment,
    p_medical_leave_days,
    p_absences,
    p_tardiness,
    p_night_hours,
    p_extra_hours,
    p_holidays,
    p_discounts
  );
$function$;

create function public.save_staff_profile(
  p_staff_id uuid default null::uuid,
  p_store_id uuid default null::uuid,
  p_first_name text default null::text,
  p_last_name text default null::text,
  p_email text default null::text,
  p_dni text default null::text,
  p_gender text default null::text,
  p_birth_date date default null::date,
  p_modality text default 'Full-Time'::text,
  p_position text default 'COLABORADOR'::text,
  p_status public.record_status default 'pending'::public.record_status,
  p_join_date date default null::date,
  p_sanitary_card_expiry date default null::date,
  p_sanitary_card_unlock boolean default false,
  p_is_trainee boolean default false,
  p_training_end_date date default null::date,
  p_modality_change_date date default null::date,
  p_next_modality text default null::text
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.save_staff_profile(
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
$function$;

create function public.save_staff_profile_and_cessation(
  p_staff_id uuid default null::uuid,
  p_store_id uuid default null::uuid,
  p_first_name text default null::text,
  p_last_name text default null::text,
  p_email text default null::text,
  p_dni text default null::text,
  p_gender text default null::text,
  p_birth_date date default null::date,
  p_modality text default 'Full-Time'::text,
  p_position text default 'COLABORADOR'::text,
  p_status public.record_status default 'pending'::public.record_status,
  p_join_date date default null::date,
  p_sanitary_card_expiry date default null::date,
  p_sanitary_card_unlock boolean default false,
  p_is_trainee boolean default false,
  p_training_end_date date default null::date,
  p_modality_change_date date default null::date,
  p_next_modality text default null::text,
  p_cessation_date date default null::date
)
returns uuid
language sql
security invoker
set search_path = ''
as $function$
  select private.save_staff_profile_and_cessation(
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
    p_next_modality,
    p_cessation_date
  );
$function$;

create function public.update_own_staff_profile(
  p_birth_date date default null::date,
  p_position_abilities jsonb default null::jsonb,
  p_pending_holidays jsonb default null::jsonb
)
returns boolean
language sql
security invoker
set search_path = ''
as $function$
  select private.update_own_staff_profile(
    p_birth_date,
    p_position_abilities,
    p_pending_holidays
  );
$function$;

-- The implementations remain callable only through authenticated/service
-- database roles. The private schema is not part of the exposed API schemas.
revoke all on function private.clear_staff_pending_holidays(uuid) from public, anon;
revoke all on function private.finish_staff_training(uuid, date) from public, anon;
revoke all on function private.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) from public, anon;
revoke all on function private.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) from public, anon;
revoke all on function private.replace_staff_skills(uuid, text[]) from public, anon;
revoke all on function private.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) from public, anon;
revoke all on function private.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) from public, anon;
revoke all on function private.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) from public, anon;
revoke all on function private.update_own_staff_profile(date, jsonb, jsonb) from public, anon;

grant execute on function private.clear_staff_pending_holidays(uuid) to authenticated, service_role;
grant execute on function private.finish_staff_training(uuid, date) to authenticated, service_role;
grant execute on function private.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) to authenticated, service_role;
grant execute on function private.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) to authenticated, service_role;
grant execute on function private.replace_staff_skills(uuid, text[]) to authenticated, service_role;
grant execute on function private.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function private.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) to authenticated, service_role;
grant execute on function private.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) to authenticated, service_role;
grant execute on function private.update_own_staff_profile(date, jsonb, jsonb) to authenticated, service_role;

revoke all on function public.clear_staff_pending_holidays(uuid) from public, anon;
revoke all on function public.finish_staff_training(uuid, date) from public, anon;
revoke all on function public.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) from public, anon;
revoke all on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) from public, anon;
revoke all on function public.replace_staff_skills(uuid, text[]) from public, anon;
revoke all on function public.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) from public, anon;
revoke all on function public.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) from public, anon;
revoke all on function public.update_own_staff_profile(date, jsonb, jsonb) from public, anon;

grant execute on function public.clear_staff_pending_holidays(uuid) to authenticated, service_role;
grant execute on function public.finish_staff_training(uuid, date) to authenticated, service_role;
grant execute on function public.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) to authenticated, service_role;
grant execute on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.replace_staff_skills(uuid, text[]) to authenticated, service_role;
grant execute on function public.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) to authenticated, service_role;
grant execute on function public.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) to authenticated, service_role;
grant execute on function public.update_own_staff_profile(date, jsonb, jsonb) to authenticated, service_role;

comment on function public.clear_staff_pending_holidays(uuid) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.finish_staff_training(uuid, date) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.import_geovictoria_staff_profile(uuid, text, text, text, text, date, text) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.publish_suggestive_sales_goals(uuid, date, jsonb, jsonb) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.replace_staff_skills(uuid, text[]) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.save_staff_cessation(uuid, date, text, text, text, text, numeric, numeric, text, numeric, numeric, numeric, numeric) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.save_staff_profile(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.save_staff_profile_and_cessation(uuid, uuid, text, text, text, text, text, date, text, text, public.record_status, date, date, boolean, boolean, date, date, text, date) is 'Invoker API wrapper; privileged implementation is private.';
comment on function public.update_own_staff_profile(date, jsonb, jsonb) is 'Invoker API wrapper; privileged implementation is private.';

-- These are internal diagnostics. Explicit deny policies document that neither
-- browser API role may read or mutate them; service_role retains its existing
-- operational access and bypasses RLS by design.
drop policy if exists "Deny client access to staff linkage issues" on private.staff_linkage_issues;
create policy "Deny client access to staff linkage issues"
on private.staff_linkage_issues
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Deny client access to training evidence issues" on private.training_evidence_issues;
create policy "Deny client access to training evidence issues"
on private.training_evidence_issues
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

notify pgrst, 'reload schema';
