-- pending_holidays was a Firebase-era denormalized array.  The relational
-- worked_holidays table is now the only writable source of truth; retain the
-- column only as an empty compatibility field so old rows can be cleaned.
create or replace function private.enforce_empty_pending_holidays()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if jsonb_typeof(new.pending_holidays) <> 'array'
     or jsonb_array_length(new.pending_holidays) <> 0 then
    raise exception using
      errcode = '23514',
      message = 'Los feriados pendientes deben registrarse en worked_holidays';
  end if;
  return new;
end;
$function$;

revoke all on function private.enforce_empty_pending_holidays()
  from public, anon, authenticated;

drop trigger if exists staff_profiles_enforce_empty_pending_holidays
  on public.staff_profiles;
create trigger staff_profiles_enforce_empty_pending_holidays
before insert or update of pending_holidays
on public.staff_profiles
for each row execute function private.enforce_empty_pending_holidays();

create or replace function public.clear_staff_pending_holidays(p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.app_role := private.current_user_role();
  v_store_id uuid := private.current_user_store_id();
begin
  update public.staff_profiles staff
  set pending_holidays = '[]'::jsonb,
      updated_at = now()
  where staff.id = p_staff_id
    and (
      v_role = 'superadmin'
      or (v_role = 'admin' and staff.store_id = v_store_id)
    );

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Colaborador no encontrado o sin permisos';
  end if;
end;
$function$;

revoke all on function public.clear_staff_pending_holidays(uuid)
  from public, anon;
grant execute on function public.clear_staff_pending_holidays(uuid)
  to authenticated;

-- Validate the draft -> completed boundary before the AFTER trigger can award
-- a skill.  The score is derived from boolean answers, both stored signatures
-- must exist, and an authenticated actor cannot attribute completion to a
-- different trainer.
create or replace function private.validate_training_evaluation_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_response_count integer;
  v_passed_count integer;
  v_all_boolean boolean;
  v_expected_score numeric;
begin
  if new.status <> 'completed'
     or (tg_op = 'UPDATE' and old.status = 'completed') then
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
     or new.area not in ('service', 'production')
     or nullif(btrim(new.station_code), '') is null
     or nullif(btrim(new.station_name), '') is null then
    raise exception using errcode = '23514', message = 'La evaluación completada no tiene una estación o fecha válida';
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

  if v_response_count = 0 or not v_all_boolean then
    raise exception using errcode = '23514', message = 'Completa todos los criterios con respuestas booleanas';
  end if;

  v_expected_score := round((v_passed_count::numeric * 100) / v_response_count);
  if new.score is distinct from v_expected_score then
    raise exception using errcode = '23514', message = 'El puntaje no coincide con las respuestas registradas';
  end if;

  if nullif(btrim(new.collaborator_signature_path), '') is null
     or nullif(btrim(new.trainer_signature_path), '') is null
     or new.collaborator_signature_path = new.trainer_signature_path
     or split_part(new.collaborator_signature_path, '/', 1) <> new.store_id::text
     or split_part(new.trainer_signature_path, '/', 1) <> new.store_id::text then
    raise exception using errcode = '23514', message = 'Se requieren dos firmas válidas de la misma tienda';
  end if;

  if not exists (
       select 1
       from storage.objects object
       where object.bucket_id = 'training-signatures'
         and object.name = new.collaborator_signature_path
     )
     or not exists (
       select 1
       from storage.objects object
       where object.bucket_id = 'training-signatures'
         and object.name = new.trainer_signature_path
     ) then
    raise exception using errcode = '23514', message = 'Las firmas de la evaluación no existen en el almacenamiento privado';
  end if;

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
  collaborator_signature_path, trainer_signature_path
on public.training_evaluations
for each row execute function private.validate_training_evaluation_completion();
