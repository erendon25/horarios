-- Restore Sheetout while keeping the maximum of two selected areas unchanged.
update public.competition_areas a set active=true
from public.competitions c
where c.id=a.competition_id and c.status='draft' and a.name='Sheetout';

-- Drafts created with the six-area template may not have a Sheetout row yet.
do $$
declare c record; area_id uuid;
begin
 for c in select comp.id from public.competitions comp where comp.status='draft'
   and not exists(select 1 from public.competition_areas a where a.competition_id=comp.id and a.name='Sheetout') loop
   update public.competition_areas set sort_order=sort_order+1 where competition_id=c.id and sort_order>=4;
   insert into public.competition_areas(competition_id,name,sort_order) values(c.id,'Sheetout',4) returning id into area_id;
   insert into public.competition_rubric_items(competition_id,area_id,label,max_score,sort_order)
   select c.id,area_id,r.label,r.score,r.ord from (values
     ('Procedimiento correcto',25,1),('Porcionamiento / cantidades',25,2),
     ('Presentación',20,3),('Técnica',15,4),('Orden y limpieza',10,5),('Seguridad/manipulación',5,6)
   ) as r(label,score,ord);
 end loop;
end $$;

do $$
declare
 definition text := pg_get_functiondef('private.competition_admin_command(uuid,text,jsonb)'::regprocedure);
 old_areas text := 'array[''Landing'',''Landing Crazy'',''Vestido'',''Masa'',''Drive Thru'',''Servicio'']';
begin
 if position(old_areas in definition)=0 then raise exception 'No se encontró la lista inicial de áreas'; end if;
 execute replace(definition,old_areas,'array[''Landing'',''Landing Crazy'',''Vestido'',''Sheetout'',''Masa'',''Drive Thru'',''Servicio'']');
end $$;
revoke all on function private.competition_admin_command(uuid,text,jsonb) from public,anon,authenticated;

create or replace function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_action='register' and not exists(
   select 1 from public.competition_areas a where a.competition_id=p_competition_id
     and a.id=(p_payload->>'area_id')::uuid
     and a.name in ('Landing','Landing Crazy','Vestido','Sheetout','Masa','Drive Thru','Servicio')
 ) then raise exception 'Elige una de las siete áreas del concurso'; end if;
 return private.competition_command_before_selected_areas(p_competition_id,p_action,p_payload);
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;

-- Notify clients of the changed area list without publishing a hidden contest.
update public.competitions c set updated_at=clock_timestamp()
where c.status='draft' and exists(select 1 from public.competition_areas a where a.competition_id=c.id and a.name='Sheetout');
