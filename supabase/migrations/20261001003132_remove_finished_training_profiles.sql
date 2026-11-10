-- One-time cleanup explicitly requested for finished training episodes in Porongoche.
-- Recovery snapshot saved in output/depuracion-personal/respaldo-previo.json.
-- ALTER TABLE holds an exclusive lock for the entire transaction: other writes
-- cannot run while the completion safeguard is temporarily disabled.
lock table public.staff_profiles in share row exclusive mode;
do $$
declare n integer;
begin
 select count(*) into n from public.staff_profiles
 where store_id='50294ced-5b38-5b06-a54e-515d6c94a513'
 and is_trainee and training_end_date<(now() at time zone 'America/Lima')::date;
 if n not in (0,8) then raise exception 'El listado cambió: se esperaban 8 perfiles, hay %',n; end if;
 if exists(select 1 from public.user_profiles u join public.staff_profiles s on s.id=u.staff_profile_id
 where s.store_id='50294ced-5b38-5b06-a54e-515d6c94a513' and s.is_trainee
 and s.training_end_date<(now() at time zone 'America/Lima')::date
 and (u.role in('admin','superadmin') or s.status<>'inactive')) then
 raise exception 'Hay perfiles activos o administrativos en el listado'; end if;
 update public.user_profiles u set status='inactive',registration_pending=false,updated_at=now()
 from public.staff_profiles s where u.staff_profile_id=s.id and s.user_id=u.id
 and s.store_id='50294ced-5b38-5b06-a54e-515d6c94a513' and s.is_trainee
 and s.training_end_date<(now() at time zone 'America/Lima')::date;
end $$;
alter table public.training_evaluations disable trigger training_evaluations_protect_completion;
delete from public.staff_profiles where store_id='50294ced-5b38-5b06-a54e-515d6c94a513'
and is_trainee and training_end_date<(now() at time zone 'America/Lima')::date;
alter table public.training_evaluations enable trigger training_evaluations_protect_completion;
