-- Every personnel movement must use staff_profiles.id as its stable identity.
-- These three Firebase accounts produced historical extra-hours rows but never
-- had a staff document, so no truthful operational store or legal name can be
-- recovered. Preserve them under the existing inactive historical store rather
-- than inventing employment data or deleting the movements.

with historical_store as (
  select id
  from public.stores
  where firestore_id = '__historical_unassigned__'
  limit 1
),
missing_identities(firebase_uid, email, display_name) as (
  values
    ('aCQgaQy5OFbkpW5Wn4eEUABPRR62', 'cutupla021001@gmail.com', 'Histórico aCQgaQ'),
    ('jLxcBQWJ3xYgdQNu1a3nCspgbxW2', 'zelimar.dm03@gmail.com', 'Histórico jLxcBQ'),
    ('daRtLULaf3Q7Pft9Sy39QHNqBX52', 'lucerobenavente@gmail.com', 'Histórico daRtLU')
)
insert into public.staff_profiles (
  firestore_id,
  store_id,
  first_name,
  last_name,
  email,
  status,
  needs_completion,
  legacy_data
)
select
  '__historical_extra_hours__:' || identity.firebase_uid,
  store.id,
  identity.display_name,
  '',
  identity.email,
  'inactive'::public.record_status,
  false,
  jsonb_build_object(
    'reconstructed_from_history', true,
    'source_identifier', identity.firebase_uid,
    'evidence', jsonb_build_object(
      'uid', identity.firebase_uid,
      'email', identity.email,
      'source', 'extra_hours'
    ),
    'reconstruction_reason', 'extra_hours_without_staff_profile'
  )
from missing_identities identity
cross join historical_store store
on conflict (firestore_id) do nothing;

update public.extra_hours movement
set
  staff_id = staff.id,
  store_id = staff.store_id,
  legacy_data = movement.legacy_data || jsonb_build_object(
    'identity_reconciled_at', now(),
    'identity_reconciliation', 'historical_staff_profile'
  )
from public.staff_profiles staff
where movement.staff_id is null
  and staff.firestore_id = '__historical_extra_hours__:' || (movement.legacy_data->>'uid');

do $$
begin
  if exists (
    select 1
    from public.extra_hours
    where staff_id is null or store_id is null
  ) then
    raise exception 'Cannot enforce extra_hours staff linkage: unresolved historical rows remain';
  end if;
end
$$;

alter table public.extra_hours
  alter column staff_id set not null,
  alter column store_id set not null;

comment on column public.extra_hours.staff_id is
  'Canonical collaborator identity. Required even when the auth account changes after cessation or rehire.';

comment on column public.extra_hours.user_id is
  'Auth account that recorded the movement; historical and intentionally not the canonical collaborator identity.';
