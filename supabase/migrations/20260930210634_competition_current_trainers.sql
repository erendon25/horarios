-- Team associations are historical; leadership follows the current HR position.
create function private.competition_trainer_eligible(p_staff_id uuid,p_competition_id uuid)
returns boolean language sql volatile security definer set search_path='' as $$
 select private.competition_staff_eligible(p_staff_id,p_competition_id) and exists (
   select 1 from public.staff_profiles s where s.id=p_staff_id and upper(trim(s.position))='ENTRENADOR'
 ) and exists (
   select 1 from public.competitions c where c.id=p_competition_id
     and (private.current_user_role() in ('admin','superadmin') or c.published_at is not null)
 )
$$;
revoke all on function private.competition_trainer_eligible(uuid,uuid) from public,anon;
grant execute on function private.competition_trainer_eligible(uuid,uuid) to authenticated;

create view public.competition_current_teams with(security_invoker=true) as
select t.id,t.competition_id,t.name,
 case when private.competition_trainer_eligible(t.trainer_staff_id,t.competition_id) then t.trainer_staff_id else null end trainer_staff_id,
 case when private.competition_trainer_eligible(t.trainer_staff_id,t.competition_id) then t.trainer_name else 'Sin trainer vigente' end trainer_name,
 private.competition_trainer_eligible(t.trainer_staff_id,t.competition_id) trainer_eligible
from public.competition_teams t;
revoke all on public.competition_current_teams from public,anon;
grant select on public.competition_current_teams to authenticated;

create or replace view public.competition_trainer_ranking with(security_invoker=true) as
select * from public.competition_team_ranking t
where private.competition_trainer_eligible(t.trainer_staff_id,t.competition_id);

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_current_trainers;
revoke all on function private.competition_command_before_current_trainers(uuid,text,jsonb) from public,anon,authenticated;
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.competitions%rowtype;
 v_role public.app_role := private.current_user_role();
 item jsonb;
begin
 if p_action in ('team','roster') then
   if auth.uid() is null or v_role is null or v_role not in ('admin','superadmin') then
     raise exception 'Solo administradores activos pueden gestionar concursos' using errcode='42501';
   end if;
   select * into c from public.competitions where id=p_competition_id for update;
   if not found then raise exception 'Concurso no disponible'; end if;
   if v_role<>'superadmin' and c.store_id is distinct from private.current_user_store_id() then
     raise exception 'Tienda no autorizada' using errcode='42501';
   end if;
   if p_action='team' then
     perform 1 from public.staff_profiles where id=(p_payload->>'trainer_staff_id')::uuid for share;
     if not private.competition_trainer_eligible((p_payload->>'trainer_staff_id')::uuid,c.id) then
       raise exception 'El líder debe tener el puesto ENTRENADOR y estar disponible en esta tienda';
     end if;
   else
     for item in select value from jsonb_array_elements(p_payload->'teams') loop
       perform 1 from public.staff_profiles where id=(item->>'trainer_staff_id')::uuid for share;
       if not private.competition_trainer_eligible((item->>'trainer_staff_id')::uuid,c.id) then
         raise exception 'Todos los líderes deben tener el puesto ENTRENADOR y estar disponibles en esta tienda';
       end if;
     end loop;
   end if;
 end if;
 return private.competition_command_before_current_trainers(p_competition_id,p_action,p_payload);
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;
create or replace function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.competition_command(p_competition_id,p_action,p_payload)
$$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
