-- Remove only team-size restrictions from the underlying command. Keep all
-- authorization, employment, registration and per-person area checks intact.
do $$
declare
 definition text := pg_get_functiondef('private.competition_admin_command(uuid,text,jsonb)'::regprocedure);
 restriction text;
begin
 foreach restriction in array array[
   ' or exists(select 1 from public.competition_team_members where competition_id=c.id group by team_id having count(*)>c.team_size)',
   'if (select count(*) from public.competition_team_members where team_id=v_team and staff_id<>sp.id)>=c.team_size then raise exception ''Equipo completo''; end if;',
   'if jsonb_array_length(p_payload->''staff_ids'')>cardinality(v_ids)*c.team_size then raise exception ''Se excede la capacidad''; end if;'
 ] loop
   if position(restriction in definition)=0 then
     raise exception 'No se encontró la restricción esperada de tamaño de equipo';
   end if;
   definition := replace(definition,restriction,'');
 end loop;
 execute definition;
end $$;
-- Replacing the function must not expose the internal command.
revoke all on function private.competition_admin_command(uuid,text,jsonb) from public,anon,authenticated;

-- Variable team sizes also require removing the fixed team quota per area.
-- The maximum areas per person and minimum entrants per area remain in force.
do $$
declare
 definition text := pg_get_functiondef('private.competition_command_before_publication(uuid,text,jsonb)'::regprocedure);
 restriction text;
begin
 foreach restriction in array array[
   'if (select count(*) from public.competition_entries x join public.competition_team_members tm on tm.id=x.member_id where x.area_id=a.id and tm.team_id=m.team_id)>=2 then raise exception ''Cupo completo: máximo 2 integrantes de tu equipo por área''; end if;',
   'if found and (select count(*) from public.competition_entries x join public.competition_team_members tm on tm.id=x.member_id where x.area_id=(p_payload->>''area_id'')::uuid and tm.team_id=m.team_id)>=2 then raise exception ''Cupo completo: máximo 2 integrantes del equipo por área''; end if;',
   'if p_action in (''member'',''status'') and exists(select 1 from public.competition_entries x join public.competition_team_members tm on tm.id=x.member_id where x.competition_id=c.id group by x.area_id,tm.team_id having count(*)>2) then raise exception ''Cupo completo: máximo 2 integrantes del equipo por área''; end if;'
 ] loop
   if position(restriction in definition)=0 then
     raise exception 'No se encontró la restricción esperada de integrantes por área';
   end if;
   definition := replace(definition,restriction,'');
 end loop;
 execute definition;
end $$;
revoke all on function private.competition_command_before_publication(uuid,text,jsonb) from public,anon,authenticated;

-- Include every assigned collaborator, even those with zero points. The leader
-- is not a member. Preserve team totals and history; never round before ranking.
create or replace view public.competition_trainer_ranking with(security_invoker=true) as
select t.competition_id,t.team_id,t.team_name,t.trainer_staff_id,t.trainer_name,
 coalesce(t.points/nullif(t.members,0),0::numeric) points,
 t.members,t.champions,t.phase_approvals,t.points team_points
from public.competition_team_ranking t
where private.competition_trainer_eligible(t.trainer_staff_id,t.competition_id);
revoke all on public.competition_trainer_ranking from public,anon;
grant select on public.competition_trainer_ranking to authenticated;
