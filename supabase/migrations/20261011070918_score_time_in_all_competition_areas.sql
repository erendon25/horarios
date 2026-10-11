-- Extend the production-area template to score time like Drive Thru/Servicio.
-- Preserve the existing command authorization and observable-checklist wrapper.
do $$
declare
  definition text := pg_get_functiondef('private.competition_admin_command(uuid,text,jsonb)'::regprocedure);
  previous_template text := '[["Procedimiento correcto",25],["Porcionamiento / cantidades",25],["Presentación",20],["Técnica",15],["Orden y limpieza",10],["Seguridad/manipulación",5]]';
  next_template text := '[["Procedimiento correcto",20],["Porcionamiento / cantidades",20],["Presentación",15],["Técnica",15],["Orden y limpieza",10],["Seguridad/manipulación",5],["Tiempo",15]]';
begin
  if position(previous_template in definition) = 0 then
    raise exception 'No se encontró la plantilla inicial de evaluación';
  end if;
  execute replace(definition, previous_template, next_template);
end;
$$;

-- Upgrade untouched templates in drafts only. Custom rubrics and any contest
-- with evaluation history retain their configured weights and snapshots.
do $$
declare
  area record;
begin
  for area in
    select a.id, a.name, a.competition_id
    from public.competition_areas a
    join public.competitions c on c.id = a.competition_id
    join public.competition_rubric_items r on r.area_id = a.id
    where c.status = 'draft' and c.checklist_required
      and a.name in ('Landing', 'Landing Crazy', 'Vestido', 'Sheetout', 'Masa')
      and not exists (
        select 1 from public.competition_evaluations e where e.competition_id = c.id
      )
    group by a.id, a.name, a.competition_id
    having jsonb_agg(jsonb_build_array(r.label, r.max_score) order by r.sort_order)
      = '[["Procedimiento correcto",25],["Porcionamiento / cantidades",25],["Presentación",20],["Técnica",15],["Orden y limpieza",10],["Seguridad/manipulación",5]]'::jsonb
      and bool_and(r.checklist = private.competition_default_checklist(a.name, r.label, r.max_score))
  loop
    update public.competition_rubric_items r
    set max_score = weights.points,
        checklist = private.competition_default_checklist(area.name, r.label, weights.points)
    from (values
      ('Procedimiento correcto', 20),
      ('Porcionamiento / cantidades', 20),
      ('Presentación', 15)
    ) as weights(label, points)
    where r.area_id = area.id and r.label = weights.label;

    insert into public.competition_rubric_items
      (competition_id, area_id, label, max_score, sort_order, checklist)
    values (area.competition_id, area.id, 'Tiempo', 15, 7,
      private.competition_default_checklist(area.name, 'Tiempo', 15));
  end loop;
end;
$$;

-- Refresh already-open admin views through the existing realtime subscription.
update public.competitions c set updated_at = clock_timestamp()
where c.status = 'draft' and exists (
  select 1 from public.competition_areas a
  join public.competition_rubric_items r on r.area_id = a.id
  where a.competition_id = c.id
    and a.name in ('Landing', 'Landing Crazy', 'Vestido', 'Sheetout', 'Masa')
    and r.label = 'Tiempo'
);
