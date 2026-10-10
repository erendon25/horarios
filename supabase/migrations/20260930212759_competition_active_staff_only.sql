-- Participation follows current employment, independently of account registration.
create or replace function private.competition_staff_eligible(p_staff_id uuid,p_competition_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select exists (
  select 1 from public.staff_profiles s join public.competitions c on c.store_id=s.store_id
  where s.id=p_staff_id and c.id=p_competition_id and s.status='active'
    and (s.cessation_date is null or s.cessation_date >= (clock_timestamp() at time zone 'America/Lima')::date)
    and (not coalesce(s.is_trainee,false) or s.training_end_date is null or s.training_end_date >= (clock_timestamp() at time zone 'America/Lima')::date)
    and auth.uid() is not null
    and (private.current_user_role()='superadmin' or (private.current_user_role() is not null and c.store_id=private.current_user_store_id()))
 )
$$;
revoke all on function private.competition_staff_eligible(uuid,uuid) from public,anon;
grant execute on function private.competition_staff_eligible(uuid,uuid) to authenticated;

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_active_staff;
revoke all on function private.competition_command_before_active_staff(uuid,text,jsonb) from public,anon,authenticated;
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.competitions%rowtype;
 v_role public.app_role := private.current_user_role();
begin
 if p_action='member' then
   if auth.uid() is null or v_role is null or v_role not in ('admin','superadmin') then
     raise exception 'Solo administradores activos pueden gestionar concursos' using errcode='42501';
   end if;
   select * into c from public.competitions where id=p_competition_id for update;
   if not found then raise exception 'Concurso no disponible'; end if;
   if v_role<>'superadmin' and c.store_id is distinct from private.current_user_store_id() then
     raise exception 'Tienda no autorizada' using errcode='42501';
   end if;
   perform 1 from public.staff_profiles where id=(p_payload->>'staff_id')::uuid for share;
   if not private.competition_staff_eligible((p_payload->>'staff_id')::uuid,c.id) then
     raise exception 'Solo colaboradores activos sin cese efectivo ni entrenamiento finalizado pueden integrar equipos';
   end if;
 end if;
 return private.competition_command_before_active_staff(p_competition_id,p_action,p_payload);
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;
create or replace function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.competition_command(p_competition_id,p_action,p_payload)
$$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
