-- Canonical completion criteria mirrored from the versioned training catalog.
-- A completed evaluation must contain exactly this key set; a one-answer object
-- can no longer produce a 100% accreditation.
alter table public.training_evaluations
  add column if not exists completion_verified_at timestamptz,
  add column if not exists completion_version integer;

comment on column public.training_evaluations.completion_verified_at is
  'Set by the canonical completion validator; NULL for drafts and unverified legacy completions.';
comment on column public.training_evaluations.completion_version is
  'Canonical completion-validation protocol version; currently 1.';

alter table public.training_evaluations
  drop constraint if exists training_evaluations_completion_verification_check;
alter table public.training_evaluations
  add constraint training_evaluations_completion_verification_check check (
    (
      completion_verified_at is null
      and completion_version is null
    )
    or (
      status = 'completed'
      and completion_verified_at is not null
      and completion_version = 1
    )
  );

create table if not exists private.training_evaluation_templates (
  area text not null,
  station_code text not null,
  expected_response_keys text[] not null,
  updated_at timestamptz not null default now(),
  primary key (area, station_code),
  constraint training_template_area_check check (area in ('service', 'production')),
  constraint training_template_keys_check check (cardinality(expected_response_keys) > 0)
);

revoke all on table private.training_evaluation_templates
  from public, anon, authenticated;

insert into private.training_evaluation_templates (area, station_code, expected_response_keys)
values
  (
    'service',
    'SERVICIO',
    array['appearance_1','hygiene_2','preparation_3','preparation_4']
      || array(select 'SERVICIO_' || point from generate_series(1, 10) point)
      || array(select 'knowledge_' || point from generate_series(18, 24) point)
  ),
  (
    'service',
    'DESPACHO',
    array['appearance_1','hygiene_2','preparation_3','preparation_4']
      || array(select 'DESPACHO_' || point from generate_series(1, 9) point)
      || array(select 'knowledge_' || point from generate_series(18, 24) point)
  ),
  (
    'service',
    'DELIVERY',
    array['appearance_1','hygiene_2','preparation_3','preparation_4']
      || array(select 'DELIVERY_' || point from generate_series(1, 12) point)
      || array(select 'knowledge_' || point from generate_series(18, 24) point)
  ),
  (
    'service',
    'TRAFICO',
    array['appearance_1','hygiene_2','preparation_3','preparation_4']
      || array(select 'TRAFICO_' || point from generate_series(1, 10) point)
      || array(select 'knowledge_' || point from generate_series(18, 24) point)
  ),
  (
    'production',
    'PREPARACION',
    array['appearance_1','appearance_2','hygiene_3','preparation_4','preparation_5','preparation_6']
      || array(select 'PREPARACION_' || point from generate_series(1, 22) point)
  ),
  (
    'production',
    'SHEETOUT',
    array['appearance_1','appearance_2','hygiene_3','preparation_4','preparation_5','preparation_6']
      || array(select 'SHEETOUT_' || point from generate_series(1, 38) point)
  ),
  (
    'production',
    'VESTIDO',
    array['appearance_1','appearance_2','hygiene_3','preparation_4','preparation_5','preparation_6']
      || array(select 'VESTIDO_' || point from generate_series(1, 17) point)
  ),
  (
    'production',
    'LANDING',
    array['appearance_1','appearance_2','hygiene_3','preparation_4','preparation_5','preparation_6']
      || array(select 'LANDING_' || point from generate_series(1, 38) point)
  ),
  (
    'production',
    'LAVADO',
    array['appearance_1','appearance_2','hygiene_3','preparation_4','preparation_5','preparation_6']
      || array(select 'LAVADO_' || point from generate_series(1, 9) point)
  )
on conflict (area, station_code) do update
set expected_response_keys = excluded.expected_response_keys,
    updated_at = now();

create or replace function private.validate_training_evaluation_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_expected_keys text[];
  v_response_count integer;
  v_passed_count integer;
  v_all_boolean boolean;
  v_expected_score numeric;
  v_collaborator_path_match text[];
  v_trainer_path_match text[];
begin
  if new.status <> 'completed' then
    new.completion_verified_at := null;
    new.completion_version := null;
    return new;
  end if;

  -- Completed rows are already protected as immutable by the earlier history
  -- trigger.  Keeping this branch avoids trying to re-verify legacy evidence
  -- when PostgreSQL evaluates another BEFORE trigger for an unrelated reason.
  if tg_op = 'UPDATE' and old.status = 'completed' then
    return new;
  end if;

  if new.trainer_id is null
     or (v_actor_id is not null and new.trainer_id is distinct from v_actor_id) then
    raise exception using
      errcode = '23514',
      message = 'La evaluación debe atribuirse al entrenador autenticado';
  end if;

  if new.evaluation_date > (now() at time zone 'America/Lima')::date
     or nullif(btrim(new.area), '') is null
     or nullif(btrim(new.station_code), '') is null
     or nullif(btrim(new.station_name), '') is null then
    raise exception using errcode = '23514', message = 'La evaluación completada no tiene una estación o fecha válida';
  end if;

  select template.expected_response_keys
  into v_expected_keys
  from private.training_evaluation_templates template
  where template.area = new.area
    and template.station_code = new.station_code;

  if not found then
    raise exception using errcode = '23514', message = 'La estación no tiene un catálogo de evaluación vigente';
  end if;

  if jsonb_typeof(new.responses) <> 'object'
     or jsonb_typeof(new.feedback) <> 'object' then
    raise exception using errcode = '23514', message = 'Respuestas o retroalimentación no válidas';
  end if;

  select
    count(*)::integer,
    count(*) filter (where answer.value = 'true'::jsonb)::integer,
    coalesce(bool_and(jsonb_typeof(answer.value) = 'boolean'), false)
  into v_response_count, v_passed_count, v_all_boolean
  from jsonb_each(new.responses) answer;

  if v_response_count <> cardinality(v_expected_keys)
     or not (new.responses ?& v_expected_keys)
     or not v_all_boolean then
    raise exception using
      errcode = '23514',
      message = 'Las respuestas no coinciden con todos los criterios vigentes de la estación';
  end if;

  v_expected_score := round((v_passed_count::numeric * 100) / v_response_count);
  if new.score is distinct from v_expected_score then
    raise exception using errcode = '23514', message = 'El puntaje no coincide con las respuestas registradas';
  end if;

  v_collaborator_path_match := pg_catalog.regexp_match(
    new.collaborator_signature_path,
    '^' || new.store_id::text || '/' || new.id::text
      || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-collaborator[.]png$',
    'i'
  );
  v_trainer_path_match := pg_catalog.regexp_match(
    new.trainer_signature_path,
    '^' || new.store_id::text || '/' || new.id::text
      || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-trainer[.]png$',
    'i'
  );

  if v_collaborator_path_match is null
     or v_trainer_path_match is null
     or v_collaborator_path_match[1] <> v_trainer_path_match[1] then
    raise exception using
      errcode = '23514',
      message = 'Las firmas deben usar la ruta canónica de la evaluación y el mismo identificador de evidencia';
  end if;

  if exists (
    select 1
    from public.training_evaluations evaluation
    where evaluation.id <> new.id
      and (
        new.collaborator_signature_path in (
          evaluation.collaborator_signature_path,
          evaluation.trainer_signature_path
        )
        or new.trainer_signature_path in (
          evaluation.collaborator_signature_path,
          evaluation.trainer_signature_path
        )
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'Una firma no puede reutilizarse en otra evaluación';
  end if;

  perform 1
  from storage.objects object
  where object.bucket_id = 'training-signatures'
    and object.name = new.collaborator_signature_path
  for key share;
  if not found then
    raise exception using errcode = '23514', message = 'La firma del colaborador no existe en el almacenamiento privado';
  end if;

  perform 1
  from storage.objects object
  where object.bucket_id = 'training-signatures'
    and object.name = new.trainer_signature_path
  for key share;
  if not found then
    raise exception using errcode = '23514', message = 'La firma del entrenador no existe en el almacenamiento privado';
  end if;

  -- Never trust client-provided verification metadata.  It is minted only
  -- after the exact catalog, score, evidence-path and object checks succeed.
  new.completion_verified_at := now();
  new.completion_version := 1;

  return new;
end;
$function$;

revoke all on function private.validate_training_evaluation_completion()
  from public, anon, authenticated;

drop trigger if exists training_evaluations_validate_completion
  on public.training_evaluations;
create trigger training_evaluations_validate_completion
before insert or update of status, score, responses, feedback, trainer_id,
  evaluation_date, area, station_code, station_name,
  collaborator_signature_path, trainer_signature_path,
  completion_verified_at, completion_version
on public.training_evaluations
for each row execute function private.validate_training_evaluation_completion();

-- Do not rewrite or discard historical evidence that predates canonical object
-- paths. Record it for explicit review before enforcing the invariant on new
-- completions.
create table if not exists private.training_evidence_issues (
  evaluation_id bigint not null references public.training_evaluations(id) on delete cascade,
  issue_code text not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  primary key (evaluation_id, issue_code),
  constraint training_evidence_issue_code_check
    check (length(btrim(issue_code)) between 1 and 100)
);

alter table private.training_evidence_issues enable row level security;
revoke all on table private.training_evidence_issues
  from public, anon, authenticated;

-- Historical completed rows predate the exact validator.  Keep them readable
-- and immutable, but make their unverified status explicit instead of
-- retroactively blessing or rewriting their evidence.
insert into private.training_evidence_issues (
  evaluation_id,
  issue_code,
  details
)
select
  evaluation.id,
  'legacy_unverified_completion',
  jsonb_strip_nulls(jsonb_build_object(
    'evaluation_date', evaluation.evaluation_date,
    'station_code', nullif(btrim(evaluation.station_code), ''),
    'score', evaluation.score
  ))
from public.training_evaluations evaluation
where evaluation.status = 'completed'
  and evaluation.completion_verified_at is null
  and evaluation.completion_version is null
on conflict (evaluation_id, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

with evidence as (
  select
    evaluation.id,
    evaluation.store_id,
    evaluation.collaborator_signature_path,
    evaluation.trainer_signature_path,
    pg_catalog.regexp_match(
      evaluation.collaborator_signature_path,
      '^' || evaluation.store_id::text || '/' || evaluation.id::text
        || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-collaborator[.]png$',
      'i'
    ) as collaborator_match,
    pg_catalog.regexp_match(
      evaluation.trainer_signature_path,
      '^' || evaluation.store_id::text || '/' || evaluation.id::text
        || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-trainer[.]png$',
      'i'
    ) as trainer_match
  from public.training_evaluations evaluation
  where evaluation.status = 'completed'
)
insert into private.training_evidence_issues (
  evaluation_id,
  issue_code,
  details
)
select
  evidence.id,
  'noncanonical_signature_pair',
  jsonb_build_object(
    'collaborator_path_length', length(evidence.collaborator_signature_path),
    'collaborator_path_md5', md5(coalesce(evidence.collaborator_signature_path, '')),
    'trainer_path_length', length(evidence.trainer_signature_path),
    'trainer_path_md5', md5(coalesce(evidence.trainer_signature_path, ''))
  )
from evidence
where evidence.collaborator_match is null
   or evidence.trainer_match is null
   or evidence.collaborator_match[1] <> evidence.trainer_match[1]
on conflict (evaluation_id, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

insert into private.training_evidence_issues (
  evaluation_id,
  issue_code,
  details
)
select
  evaluation.id,
  'missing_signature_object',
  jsonb_build_object(
    'collaborator_missing', not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'training-signatures'
        and object.name = evaluation.collaborator_signature_path
    ),
    'trainer_missing', not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'training-signatures'
        and object.name = evaluation.trainer_signature_path
    )
  )
from public.training_evaluations evaluation
where evaluation.status = 'completed'
  and (
    not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'training-signatures'
        and object.name = evaluation.collaborator_signature_path
    )
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'training-signatures'
        and object.name = evaluation.trainer_signature_path
    )
  )
on conflict (evaluation_id, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

insert into private.training_evidence_issues (
  evaluation_id,
  issue_code,
  details
)
select
  evaluation.id,
  'reused_signature_object',
  jsonb_build_object(
    'other_evaluation_ids',
    jsonb_agg(distinct other.id order by other.id)
  )
from public.training_evaluations evaluation
join public.training_evaluations other
  on other.id <> evaluation.id
 and (
   evaluation.collaborator_signature_path in (
     other.collaborator_signature_path,
     other.trainer_signature_path
   )
   or evaluation.trainer_signature_path in (
     other.collaborator_signature_path,
     other.trainer_signature_path
   )
 )
where evaluation.status = 'completed'
group by evaluation.id
on conflict (evaluation_id, issue_code) do update
set details = excluded.details,
    detected_at = now(),
    resolved_at = null;

-- Only versioned, canonical completions may grant a skill or feed the staff
-- training summary.  Existing skills are deliberately retained: historical
-- rows do not preserve enough provenance to identify which skills came from a
-- legacy evaluation rather than another legitimate workflow.
create or replace function private.apply_completed_training_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_position_id bigint;
begin
  if new.status <> 'completed'
     or new.completion_verified_at is null
     or new.completion_version is distinct from 1 then
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

  update public.staff_profiles staff
  set training_scores = case
        when nullif(btrim(new.station_code), '') is null or new.score is null
          then staff.training_scores
        else jsonb_set(
          coalesce(staff.training_scores, '{}'::jsonb),
          array[btrim(new.station_code)],
          to_jsonb(new.score),
          true
        )
      end,
      last_evaluation_date = case
        when staff.last_evaluation_date is null
          or new.evaluation_date >= staff.last_evaluation_date
          then new.evaluation_date
        else staff.last_evaluation_date
      end,
      last_evaluation_score = case
        when staff.last_evaluation_date is null
          or new.evaluation_date >= staff.last_evaluation_date
          then new.score
        else staff.last_evaluation_score
      end,
      last_station_evaluated = case
        when staff.last_evaluation_date is null
          or new.evaluation_date >= staff.last_evaluation_date
          then new.station_code
        else staff.last_station_evaluated
      end,
      updated_at = now()
  where staff.id = new.staff_id;

  return new;
end;
$function$;

revoke all on function private.apply_completed_training_evaluation()
  from public, anon, authenticated;

drop trigger if exists training_evaluations_apply_completion
  on public.training_evaluations;
create trigger training_evaluations_apply_completion
after insert or update of status, score, station_code, evaluation_date,
  staff_id, store_id, completion_verified_at, completion_version
on public.training_evaluations
for each row execute function private.apply_completed_training_evaluation();

-- Rebuild only the fields that are wholly derived from evaluations.  On the
-- current dataset all completed rows are legacy/unverified, so this correctly
-- clears inflated summaries while leaving the ambiguous staff_skills history
-- untouched.
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
), verified_summaries as (
  select
    staff.id as staff_id,
    coalesce(score.training_scores, '{}'::jsonb) as training_scores,
    latest.evaluation_date as last_evaluation_date,
    latest.score as last_evaluation_score,
    latest.station_code as last_station_evaluated
  from public.staff_profiles staff
  left join score_maps score on score.staff_id = staff.id
  left join latest_evaluations latest on latest.staff_id = staff.id
)
update public.staff_profiles staff
set training_scores = summary.training_scores,
    last_evaluation_date = summary.last_evaluation_date,
    last_evaluation_score = summary.last_evaluation_score,
    last_station_evaluated = summary.last_station_evaluated,
    updated_at = now()
from verified_summaries summary
where summary.staff_id = staff.id
  and (
    staff.training_scores,
    staff.last_evaluation_date,
    staff.last_evaluation_score,
    staff.last_station_evaluated
  ) is distinct from (
    summary.training_scores,
    summary.last_evaluation_date,
    summary.last_evaluation_score,
    summary.last_station_evaluated
  );

-- The trigger gives a clear error and catches cross-column reuse.  These
-- indexes are the concurrency backstop when two evaluations try to reference
-- the same object before either transaction can see the other row.
create unique index if not exists training_evaluations_collaborator_signature_unique_idx
  on public.training_evaluations (collaborator_signature_path)
  where collaborator_signature_path ~* (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    || '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-collaborator[.]png$'
  );

create unique index if not exists training_evaluations_trainer_signature_unique_idx
  on public.training_evaluations (trainer_signature_path)
  where trainer_signature_path ~* (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    || '/[0-9]+/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-trainer[.]png$'
  );

-- Once referenced by a completed evaluation, a signature object is immutable.
create or replace function private.training_signature_is_completed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.training_evaluations evaluation
    where evaluation.status = 'completed'
      and p_name in (
        evaluation.collaborator_signature_path,
        evaluation.trainer_signature_path
      )
  )
$function$;

revoke all on function private.training_signature_is_completed(text)
  from public, anon;
grant execute on function private.training_signature_is_completed(text)
  to authenticated;

drop policy if exists training_signatures_update on storage.objects;

drop policy if exists training_signatures_delete on storage.objects;
create policy training_signatures_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'training-signatures'
  and not private.training_signature_is_completed(name)
  and (
    (select private.current_user_role()) = 'superadmin'
    or (
      (storage.foldername(name))[1] = (select private.current_user_store_id())::text
      and (select private.current_user_role()) in ('admin', 'trainer')
    )
  )
);
