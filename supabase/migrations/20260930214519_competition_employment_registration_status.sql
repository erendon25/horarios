-- HR-created profiles default to pending until account registration finishes.
-- Both active and pending can have current employment. Never activate accounts
-- or edit HR records here; session authorization remains unchanged.
create or replace function private.competition_staff_eligible(p_staff_id uuid,p_competition_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists (
  select 1 from public.staff_profiles s join public.competitions c on c.store_id=s.store_id
  where s.id=p_staff_id and c.id=p_competition_id and s.status in ('active','pending')
    and (s.cessation_date is null or s.cessation_date >= (clock_timestamp() at time zone 'America/Lima')::date)
    and (not coalesce(s.is_trainee,false) or s.training_end_date is null or s.training_end_date >= (clock_timestamp() at time zone 'America/Lima')::date)
    and auth.uid() is not null
    and (private.current_user_role()='superadmin' or (private.current_user_role() is not null and c.store_id=private.current_user_store_id()))
 )
$$;
revoke all on function private.competition_staff_eligible(uuid,uuid) from public,anon;
grant execute on function private.competition_staff_eligible(uuid,uuid) to authenticated;
