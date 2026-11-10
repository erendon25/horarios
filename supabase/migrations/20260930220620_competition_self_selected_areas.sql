-- Fixed contest rule, independent of administrator configuration.
do $$ begin
 if exists(select 1 from public.competition_entries group by competition_id,member_id having count(*)>2) then
   raise exception 'Revise las inscripciones existentes que superan dos áreas';
 end if;
end $$;
update public.competitions set max_areas_per_participant=2;
alter table public.competitions add constraint competition_two_areas_limit check(max_areas_per_participant=2);

-- Keep historical areas/results, but stop offering Sheetout in new choices.
update public.competition_areas a set active=false
where a.name='Sheetout' and not exists(select 1 from public.competition_entries e where e.area_id=a.id);
do $$
declare
 definition text := pg_get_functiondef('private.competition_admin_command(uuid,text,jsonb)'::regprocedure);
 old_areas text := 'array[''Landing'',''Landing Crazy'',''Vestido'',''Sheetout'',''Masa'',''Drive Thru'',''Servicio'']';
begin
 if position(old_areas in definition)=0 then raise exception 'No se encontró la lista inicial de áreas'; end if;
 execute replace(definition,old_areas,'array[''Landing'',''Landing Crazy'',''Vestido'',''Masa'',''Drive Thru'',''Servicio'']');
end $$;
revoke all on function private.competition_admin_command(uuid,text,jsonb) from public,anon,authenticated;

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_selected_areas;
revoke all on function private.competition_command_before_selected_areas(uuid,text,jsonb) from public,anon,authenticated;
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='register' and not exists(
   select 1 from public.competition_areas a where a.competition_id=p_competition_id
     and a.id=(p_payload->>'area_id')::uuid
     and a.name in ('Landing','Landing Crazy','Vestido','Masa','Drive Thru','Servicio')
 ) then raise exception 'Elige una de las seis áreas del concurso'; end if;
 return private.competition_command_before_selected_areas(p_competition_id,p_action,p_payload);
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;
create or replace function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.competition_command(p_competition_id,p_action,p_payload)
$$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
