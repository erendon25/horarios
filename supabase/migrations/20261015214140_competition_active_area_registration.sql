-- Allow self-registration during the initial phase of an active area.
-- Keep publication, authenticated identity, leader exclusion, store/employment
-- checks, the two-area limit and the contest lock in the existing command.
-- This migration changes rules only; existing rosters, draws and results survive.
do $migration$
declare
  definition text := pg_get_functiondef('private.competition_command_before_publication(uuid,text,jsonb)'::regprocedure);
  marker text;
begin
  foreach marker in array array[
    $marker$v_pick record; v_old jsonb;$marker$,
    $marker$if c.status<>'draft' then raise exception 'Las inscripciones están cerradas; el concurso ya fue activado'; end if;$marker$,
    $marker$insert into public.competition_entries(competition_id,member_id,area_id,current_phase_id) values(c.id,m.id,a.id,v_phase) returning id,to_jsonb(competition_entries.*) into v_entry,v_result;$marker$
  ] loop
    if (length(definition)-length(replace(definition,marker,'')))/length(marker)<>1 then
      raise exception 'No se encontró una única regla esperada de inscripción';
    end if;
  end loop;
  definition:=replace(definition,
    'v_pick record; v_old jsonb;',
    'v_pick record; v_old jsonb; v_seed integer; v_group integer;');
  definition:=replace(definition,$old$if c.status<>'draft' then raise exception 'Las inscripciones están cerradas; el concurso ya fue activado'; end if;$old$,$new$if c.status not in ('draft','active') then
     raise exception 'Las inscripciones están cerradas; el concurso ya finalizó';
   end if;
   if p_action='withdraw' and c.status<>'draft' then
     raise exception 'Las inscripciones confirmadas no se pueden retirar durante la competencia';
   end if;$new$);
  definition:=replace(definition,$old$insert into public.competition_entries(competition_id,member_id,area_id,current_phase_id) values(c.id,m.id,a.id,v_phase) returning id,to_jsonb(competition_entries.*) into v_entry,v_result;$old$,$new$if c.status='active' then
       if a.status<>'open' or exists(
         select 1 from public.competition_entries x where x.area_id=a.id
         and (x.current_phase_id<>v_phase or x.status in ('finalist','champion') or x.tiebreak_candidate)
       ) then
         raise exception 'Esta área ya avanzó de fase y no admite nuevas inscripciones';
       end if;
       -- The contest row is already locked by the public command. Append only;
       -- never redraw, renumber, move or update an existing participant/result.
       select coalesce(max(x.seed_order),0)+1,coalesce(max(x.draw_group),1)
         into v_seed,v_group from public.competition_entries x where x.area_id=a.id;
       if (select count(*) from public.competition_entries x
           where x.area_id=a.id and x.draw_group=v_group)>=2 then
         v_group:=v_group+1;
       end if;
     end if;
     insert into public.competition_entries(
       competition_id,member_id,area_id,current_phase_id,seed_order,draw_group
     ) values(c.id,m.id,a.id,v_phase,v_seed,v_group)
     returning id,to_jsonb(competition_entries.*) into v_entry,v_result;$new$);
  execute definition;
end
$migration$;
revoke all on function private.competition_command_before_publication(uuid,text,jsonb)
  from public,anon,authenticated;
notify pgrst,'reload schema';
