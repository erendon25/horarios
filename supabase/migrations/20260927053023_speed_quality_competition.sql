-- New domain; reuses stores, staff_profiles, user_profiles and audit_log.
create table public.competitions (
 id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id),
 name text not null check(length(trim(name)) between 1 and 160),
 status text not null default 'draft' check(status in ('draft','active','completed')),
 start_date date, end_date date, max_areas_per_participant integer not null default 2 check(max_areas_per_participant between 1 and 20),
 team_size integer not null default 6 check(team_size between 1 and 100),
 allow_timer_pause boolean not null default false, champion_bonus integer not null default 3 check(champion_bonus between 0 and 100),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), check(end_date is null or start_date is null or end_date >= start_date)
);
create table public.competition_teams (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id),
 name text not null check(length(trim(name)) between 1 and 100), trainer_staff_id uuid not null references public.staff_profiles(id),
 trainer_name text not null, unique(competition_id,name), unique(competition_id,trainer_staff_id), unique(id,competition_id)
);
create table public.competition_team_members (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id),
 team_id uuid not null, staff_id uuid not null references public.staff_profiles(id), display_name text not null,
 foreign key(team_id,competition_id) references public.competition_teams(id,competition_id),
 unique(competition_id,staff_id), unique(id,competition_id)
);
create table public.competition_areas (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id),
 name text not null check(length(trim(name)) between 1 and 100), minimum_quality numeric(5,2) not null default 90 check(minimum_quality between 0 and 100),
 target_duration_ms bigint check(target_duration_ms > 0), maximum_duration_ms bigint check(maximum_duration_ms > 0),
 active boolean not null default true, sort_order integer not null default 0,
 status text not null default 'open' check(status in ('open','tiebreak_required','completed')), tiebreak_round integer not null default 0 check(tiebreak_round>=0),
 unique(competition_id,name), unique(id,competition_id), check(target_duration_ms is null or target_duration_ms<=maximum_duration_ms)
);
create table public.competition_phases (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id),
 name text not null check(length(trim(name)) between 1 and 100), phase_order integer not null check(phase_order>0),
 points integer not null check(points between 0 and 100), active boolean not null default true,
 unique(competition_id,phase_order), unique(competition_id,name), unique(id,competition_id)
);
create table public.competition_rubric_items (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id), area_id uuid not null,
 label text not null check(length(trim(label)) between 1 and 160), max_score numeric(5,2) not null check(max_score>0 and max_score<=100), sort_order integer not null,
 foreign key(area_id,competition_id) references public.competition_areas(id,competition_id), unique(id,competition_id)
);
create table public.competition_entries (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id),
 member_id uuid not null, area_id uuid not null, current_phase_id uuid not null,
 status text not null default 'active' check(status in ('active','eliminated','finalist','champion')),
 champion_points integer not null default 0 check(champion_points>=0), tiebreak_candidate boolean not null default false,
 foreign key(member_id,competition_id) references public.competition_team_members(id,competition_id),
 foreign key(area_id,competition_id) references public.competition_areas(id,competition_id),
 foreign key(current_phase_id,competition_id) references public.competition_phases(id,competition_id),
 unique(member_id,area_id), unique(id,competition_id), check(champion_points=0 or status='champion')
);
create unique index competition_one_champion on public.competition_entries(area_id) where status='champion';
create table public.competition_evaluations (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id), entry_id uuid not null,
 phase_id uuid not null, attempt_number integer not null check(attempt_number>0),
 is_tiebreaker boolean not null default false, tiebreak_round integer not null default 0 check(tiebreak_round>=0),
 minimum_quality numeric(5,2) not null check(minimum_quality between 0 and 100),
 maximum_duration_ms bigint not null check(maximum_duration_ms>0), target_duration_ms bigint,
 phase_points integer not null check(phase_points>=0), allow_pause boolean not null default false,
 timer_status text not null default 'pending' check(timer_status in ('pending','running','paused','stopped','saved','cancelled','void')),
 started_at timestamptz, finished_at timestamptz, paused_at timestamptz,
 paused_duration_ms bigint not null default 0 check(paused_duration_ms>=0), duration_ms bigint check(duration_ms>=0),
 quality_score numeric(5,2) check(quality_score between 0 and 100), critical_error boolean not null default false,
 critical_error_reason text, approved boolean, points_awarded integer not null default 0 check(points_awarded>=0),
 started_by uuid references auth.users(id), evaluated_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(entry_id,competition_id) references public.competition_entries(id,competition_id),
 foreign key(phase_id,competition_id) references public.competition_phases(id,competition_id),
 unique(entry_id,phase_id,attempt_number), unique(id,competition_id),
 check(not critical_error or coalesce(length(trim(critical_error_reason)),0)>0),
 check(timer_status<>'saved' or (quality_score is not null and duration_ms is not null and approved is not null)),
 check(not is_tiebreaker or points_awarded=0)
);
create unique index competition_one_open_attempt on public.competition_evaluations(entry_id)
 where timer_status in ('pending','running','paused','stopped');
create unique index competition_phase_credit_once on public.competition_evaluations(entry_id,phase_id)
 where timer_status='saved' and approved and not is_tiebreaker;
create table public.competition_evaluation_scores (
 evaluation_id uuid not null, competition_id uuid not null references public.competitions(id), rubric_item_id uuid not null,
 label text not null, max_score numeric(5,2) not null check(max_score>0 and max_score<=100),
 score numeric(5,2) check(score>=0 and score<=max_score), sort_order integer not null,
 primary key(evaluation_id,rubric_item_id),
 foreign key(evaluation_id,competition_id) references public.competition_evaluations(id,competition_id),
 foreign key(rubric_item_id,competition_id) references public.competition_rubric_items(id,competition_id)
);
create table public.competition_timer_events (
 id uuid primary key default gen_random_uuid(), competition_id uuid not null references public.competitions(id), evaluation_id uuid not null,
 action text not null check(action in ('start','stop','pause','resume','cancel')), occurred_at timestamptz not null default clock_timestamp(),
 performed_by uuid not null references auth.users(id), reason text,
 foreign key(evaluation_id,competition_id) references public.competition_evaluations(id,competition_id)
);
create index competition_store_idx on public.competitions(store_id);
create index competition_teams_trainer_idx on public.competition_teams(trainer_staff_id);
create index competition_members_team_idx on public.competition_team_members(team_id,competition_id);
create index competition_members_staff_idx on public.competition_team_members(staff_id);
create index competition_entries_area_idx on public.competition_entries(area_id,competition_id);
create index competition_entries_phase_idx on public.competition_entries(current_phase_id,competition_id);
create index competition_evaluations_phase_idx on public.competition_evaluations(phase_id,competition_id);
create index competition_evaluations_competition_idx on public.competition_evaluations(competition_id);
create index competition_scores_competition_idx on public.competition_evaluation_scores(competition_id);
create index competition_scores_rubric_idx on public.competition_evaluation_scores(rubric_item_id,competition_id);
create index competition_events_evaluation_idx on public.competition_timer_events(evaluation_id,competition_id);
create index competition_events_competition_idx on public.competition_timer_events(competition_id);

alter table public.competitions enable row level security;
revoke all on public.competitions from public,anon,authenticated;
grant select on public.competitions to authenticated;
create policy competition_read on public.competitions for select to authenticated using (
 (select private.current_user_role())='superadmin' or
 (store_id=(select private.current_user_store_id()) and (select private.current_user_role()) is not null)
);
do $$ declare t text; begin
 foreach t in array array['competition_teams','competition_team_members','competition_areas','competition_phases','competition_rubric_items','competition_entries','competition_evaluations','competition_evaluation_scores','competition_timer_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public, anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy competition_read on public.%I for select to authenticated using (exists (select 1 from public.competitions c where c.id=competition_id))',t);
 end loop;
end $$;

-- Single serialized command boundary; never trusts client timestamps, scores totals or points.
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.competitions%rowtype; a public.competition_areas%rowtype; e public.competition_evaluations%rowtype;
 en public.competition_entries%rowtype; ph public.competition_phases%rowtype; sp public.staff_profiles%rowtype;
 v_id uuid; v_area uuid; v_team uuid; v_member uuid; v_next uuid; v_now timestamptz; v_quality numeric; v_pass boolean;
 v_old jsonb; v_result jsonb; item jsonb; v_count integer; v_index integer; v_top record; v_ids uuid[];
 v_reason text := nullif(trim(p_payload->>'reason'),''); v_role public.app_role := private.current_user_role();
begin
 if auth.uid() is null or v_role is null or v_role not in ('admin','superadmin') then raise exception 'Solo administradores activos pueden gestionar concursos' using errcode='42501'; end if;
 if p_action='create' then
   if v_role<>'superadmin' and (p_payload->>'store_id')::uuid is distinct from private.current_user_store_id() then raise exception 'Tienda no autorizada' using errcode='42501'; end if;
   if not exists(select 1 from public.stores where id=(p_payload->>'store_id')::uuid and is_active) then raise exception 'Tienda inválida'; end if;
   insert into public.competitions(store_id,name,created_by) values((p_payload->>'store_id')::uuid,coalesce(nullif(trim(p_payload->>'name'),''),'CONCURSO DE VELOCIDAD Y CALIDAD'),auth.uid()) returning * into c;
   insert into public.competition_phases(competition_id,name,phase_order,points) values(c.id,'Clasificación',1,1),(c.id,'Fase 2',2,2),(c.id,'Semifinal',3,3),(c.id,'Final',4,5);
   v_index:=0;
   foreach v_reason in array array['Landing','Landing Crazy','Vestido','Sheetout','Masa','Drive Thru','Servicio'] loop
     v_index:=v_index+1;
     insert into public.competition_areas(competition_id,name,sort_order) values(c.id,v_reason,v_index) returning id into v_area;
     for item in select value from jsonb_array_elements(case v_reason
       when 'Drive Thru' then '[["Exactitud del pedido",30],["Procedimiento",20],["Atención / comunicación",20],["Tiempo",15],["Entrega correcta",10],["Orden",5]]'::jsonb
       when 'Servicio' then '[["Exactitud",30],["Atención",25],["Procedimiento",20],["Rapidez",15],["Presentación / orden",10]]'::jsonb
       else '[["Procedimiento correcto",25],["Porcionamiento / cantidades",25],["Presentación",20],["Técnica",15],["Orden y limpieza",10],["Seguridad/manipulación",5]]'::jsonb end) loop
       insert into public.competition_rubric_items(competition_id,area_id,label,max_score,sort_order) values(c.id,v_area,item->>0,(item->>1)::numeric,(select count(*)+1 from public.competition_rubric_items where area_id=v_area));
     end loop;
   end loop;
   v_result:=to_jsonb(c); v_id:=c.id;
 else
   select * into c from public.competitions where id=p_competition_id for update;
   if not found then raise exception 'Concurso inexistente'; end if;
   if v_role<>'superadmin' and c.store_id is distinct from private.current_user_store_id() then raise exception 'Tienda no autorizada' using errcode='42501'; end if;
   v_old:=to_jsonb(c); v_id:=c.id;
   if p_action in ('config','team','member','remove_member','draw','roster','area','rubric','phase','entry','remove_entry') and c.status<>'draft' then raise exception 'La configuración solo se modifica en borrador'; end if;
   if p_action='config' then
     update public.competitions set name=coalesce(p_payload->>'name',name), max_areas_per_participant=coalesce((p_payload->>'max_areas_per_participant')::integer,max_areas_per_participant), team_size=coalesce((p_payload->>'team_size')::integer,team_size), allow_timer_pause=coalesce((p_payload->>'allow_timer_pause')::boolean,allow_timer_pause), champion_bonus=coalesce((p_payload->>'champion_bonus')::integer,champion_bonus), start_date=(p_payload->>'start_date')::date,end_date=(p_payload->>'end_date')::date where id=c.id returning * into c;
     if exists(select 1 from public.competition_entries where competition_id=c.id group by member_id having count(*)>c.max_areas_per_participant) or exists(select 1 from public.competition_team_members where competition_id=c.id group by team_id having count(*)>c.team_size) then raise exception 'El límite es menor que las asignaciones actuales'; end if;
   elsif p_action='status' then
     if p_payload->>'status'='draft' and exists(select 1 from public.competition_evaluations where competition_id=c.id) then raise exception 'No se puede editar configuración con intentos registrados'; end if;
     if p_payload->>'status'='active' then
       if not exists(select 1 from public.competition_entries where competition_id=c.id) then raise exception 'Asigne participantes a las áreas antes de activar'; end if;
       if not exists(select 1 from public.competition_phases where competition_id=c.id and active) then raise exception 'Se requiere al menos una fase activa'; end if;
       if exists(select 1 from public.competition_areas ar where ar.competition_id=c.id and ar.active and (ar.maximum_duration_ms is null or (select coalesce(sum(max_score),0) from public.competition_rubric_items where area_id=ar.id)<>100)) then raise exception 'Configure tiempos máximos y rúbricas de 100 puntos en todas las áreas activas'; end if;
       if exists(select 1 from public.competition_entries x join public.competition_areas ar on ar.id=x.area_id where x.competition_id=c.id and not ar.active) then raise exception 'Existen inscripciones en áreas desactivadas'; end if;
       if c.status='draft' then update public.competition_entries set current_phase_id=(select id from public.competition_phases where competition_id=c.id and active order by phase_order limit 1) where competition_id=c.id; end if;
     end if;
     if p_payload->>'status'='completed' and exists(select 1 from public.competition_entries x join public.competition_areas ar on ar.id=x.area_id where x.competition_id=c.id and ar.status<>'completed') then raise exception 'Resuelva todas las áreas antes de cerrar el concurso'; end if;
     update public.competitions set status=p_payload->>'status' where id=c.id returning * into c;
   elsif p_action='team' then
     select * into sp from public.staff_profiles where id=(p_payload->>'trainer_staff_id')::uuid and store_id=c.store_id and status='active' and (cessation_date is null or cessation_date >= (now() at time zone 'America/Lima')::date);
     if not found then raise exception 'Trainer no disponible en esta tienda'; end if;
     if exists(select 1 from public.competition_team_members where competition_id=c.id and staff_id=sp.id) then raise exception 'El trainer ya participa como integrante'; end if;
     v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
     if exists(select 1 from public.competition_teams where id=v_id and competition_id<>c.id) then raise exception 'Equipo ajeno'; end if;
     select to_jsonb(t) into v_old from public.competition_teams t where id=v_id;
     insert into public.competition_teams(id,competition_id,name,trainer_staff_id,trainer_name) values(v_id,c.id,p_payload->>'name',sp.id,concat_ws(' ',sp.first_name,sp.last_name)) on conflict(id) do update set name=excluded.name,trainer_staff_id=excluded.trainer_staff_id,trainer_name=excluded.trainer_name returning to_jsonb(competition_teams.*) into v_result;
   elsif p_action='member' then
     v_team:=(p_payload->>'team_id')::uuid;
     if not exists(select 1 from public.competition_teams where id=v_team and competition_id=c.id) then raise exception 'Equipo ajeno'; end if;
     select * into sp from public.staff_profiles where id=(p_payload->>'staff_id')::uuid and store_id=c.store_id and status='active' and (cessation_date is null or cessation_date >= (now() at time zone 'America/Lima')::date);
     if not found then raise exception 'Colaborador no disponible en esta tienda'; end if;
     if exists(select 1 from public.competition_teams where competition_id=c.id and trainer_staff_id=sp.id) then raise exception 'Un trainer no puede ser integrante'; end if;
     select to_jsonb(m) into v_old from public.competition_team_members m where competition_id=c.id and staff_id=sp.id;
     if (select count(*) from public.competition_team_members where team_id=v_team and staff_id<>sp.id)>=c.team_size then raise exception 'Equipo completo'; end if;
     insert into public.competition_team_members(competition_id,team_id,staff_id,display_name) values(c.id,v_team,sp.id,concat_ws(' ',sp.first_name,sp.last_name)) on conflict(competition_id,staff_id) do update set team_id=excluded.team_id returning id,to_jsonb(competition_team_members.*) into v_id,v_result;
   elsif p_action='remove_member' then
     v_id:=(p_payload->>'id')::uuid;
     delete from public.competition_team_members where id=v_id and competition_id=c.id returning to_jsonb(competition_team_members.*) into v_old;
     -- FK intentionally prevents removing an enrolled member; remove entries first.
   elsif p_action='roster' then
     if exists(select 1 from public.competition_teams where competition_id=c.id) then raise exception 'La plantilla requiere un concurso sin equipos'; end if;
     if jsonb_typeof(p_payload->'teams') is distinct from 'array' or jsonb_array_length(p_payload->'teams')=0 then raise exception 'Seleccione equipos'; end if;
     if exists(select sid from (select t->>'trainer_staff_id' sid from jsonb_array_elements(p_payload->'teams') t union all select jsonb_array_elements_text(t->'staff_ids') from jsonb_array_elements(p_payload->'teams') t) people group by sid having count(*)>1) then raise exception 'Una persona no puede repetirse en la plantilla'; end if;
     for item in select value from jsonb_array_elements(p_payload->'teams') loop
       v_result:=private.competition_command(c.id,'team',item);
       v_team:=(v_result->>'id')::uuid;
       for v_member in select value::text::uuid from jsonb_array_elements_text(item->'staff_ids') loop
         perform private.competition_command(c.id,'member',jsonb_build_object('team_id',v_team,'staff_id',v_member));
       end loop;
     end loop;
     v_result:=null;
   elsif p_action='draw' then
     if exists(select 1 from public.competition_team_members where competition_id=c.id) then raise exception 'El sorteo requiere equipos sin integrantes'; end if;
     select array_agg(id order by name) into v_ids from public.competition_teams where competition_id=c.id;
     if coalesce(cardinality(v_ids),0)=0 then raise exception 'Cree los equipos primero'; end if;
     if jsonb_array_length(p_payload->'staff_ids')>cardinality(v_ids)*c.team_size then raise exception 'Se excede la capacidad'; end if;
     if jsonb_typeof(p_payload->'staff_ids') is distinct from 'array' or jsonb_array_length(p_payload->'staff_ids')=0 then raise exception 'Seleccione integrantes'; end if;
     if exists(select value from jsonb_array_elements_text(p_payload->'staff_ids') group by value having count(*)>1) then raise exception 'Integrantes repetidos'; end if;
     v_index:=0;
     for item in select value from jsonb_array_elements(p_payload->'staff_ids') order by random() loop
       v_index:=v_index+1;
       perform private.competition_command(c.id,'member',jsonb_build_object('team_id',v_ids[1+((v_index-1)%cardinality(v_ids))],'staff_id',item#>>'{}'));
     end loop;
   elsif p_action='area' then
     v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
     if exists(select 1 from public.competition_areas where id=v_id and competition_id<>c.id) then raise exception 'Área ajena'; end if;
     select to_jsonb(ar) into v_old from public.competition_areas ar where id=v_id;
     insert into public.competition_areas(id,competition_id,name,minimum_quality,target_duration_ms,maximum_duration_ms,active,sort_order) values(v_id,c.id,p_payload->>'name',coalesce((p_payload->>'minimum_quality')::numeric,90),(p_payload->>'target_duration_ms')::bigint,(p_payload->>'maximum_duration_ms')::bigint,coalesce((p_payload->>'active')::boolean,true),coalesce((p_payload->>'sort_order')::integer,0)) on conflict(id) do update set name=excluded.name,minimum_quality=excluded.minimum_quality,target_duration_ms=excluded.target_duration_ms,maximum_duration_ms=excluded.maximum_duration_ms,active=excluded.active,sort_order=excluded.sort_order returning to_jsonb(competition_areas.*) into v_result;
   elsif p_action='rubric' then
     v_area:=(p_payload->>'area_id')::uuid;
     if not exists(select 1 from public.competition_areas where id=v_area and competition_id=c.id) then raise exception 'Área ajena'; end if;
     if (select sum((value->>'max_score')::numeric) from jsonb_array_elements(p_payload->'items')) is distinct from 100::numeric then raise exception 'La rúbrica debe sumar 100'; end if;
     select jsonb_agg(to_jsonb(r)) into v_old from public.competition_rubric_items r where area_id=v_area;
     delete from public.competition_rubric_items where area_id=v_area;
     v_index:=0;
     for item in select value from jsonb_array_elements(p_payload->'items') loop
       v_index:=v_index+1;
       insert into public.competition_rubric_items(competition_id,area_id,label,max_score,sort_order) values(c.id,v_area,item->>'label',(item->>'max_score')::numeric,v_index);
     end loop;
     v_id:=v_area;
   elsif p_action='phase' then
     v_id:=coalesce((p_payload->>'id')::uuid,gen_random_uuid());
     if exists(select 1 from public.competition_phases where id=v_id and competition_id<>c.id) then raise exception 'Fase ajena'; end if;
     select to_jsonb(p) into v_old from public.competition_phases p where id=v_id;
     insert into public.competition_phases(id,competition_id,name,phase_order,points,active) values(v_id,c.id,p_payload->>'name',(p_payload->>'phase_order')::integer,(p_payload->>'points')::integer,coalesce((p_payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,phase_order=excluded.phase_order,points=excluded.points,active=excluded.active returning to_jsonb(competition_phases.*) into v_result;
   elsif p_action='entry' then
     v_member:=(p_payload->>'member_id')::uuid; v_area:=(p_payload->>'area_id')::uuid;
     if not exists(select 1 from public.competition_team_members where id=v_member and competition_id=c.id) or not exists(select 1 from public.competition_areas where id=v_area and competition_id=c.id and active) then raise exception 'Integrante o área inválidos'; end if;
     if exists(select 1 from public.competition_entries where member_id=v_member and area_id=v_area) then return jsonb_build_object('unchanged',true); end if;
     if (select count(*) from public.competition_entries where member_id=v_member)>=c.max_areas_per_participant then raise exception 'Límite de áreas alcanzado'; end if;
     select id into v_next from public.competition_phases where competition_id=c.id and active order by phase_order limit 1;
     insert into public.competition_entries(competition_id,member_id,area_id,current_phase_id) values(c.id,v_member,v_area,v_next) returning id,to_jsonb(competition_entries.*) into v_id,v_result;
   elsif p_action='remove_entry' then
     v_id:=(p_payload->>'id')::uuid;
     delete from public.competition_entries where id=v_id and competition_id=c.id returning to_jsonb(competition_entries.*) into v_old;
   elsif p_action in ('prepare','reopen') then
     if c.status<>'active' then raise exception 'El concurso no está activo'; end if;
     select * into en from public.competition_entries where id=(p_payload->>'entry_id')::uuid and competition_id=c.id;
     if not found then raise exception 'Participación inexistente'; end if;
     select * into a from public.competition_areas where id=en.area_id;
     select * into ph from public.competition_phases where id=en.current_phase_id;
     v_old:=to_jsonb(en); v_id:=en.id;
     if p_action='reopen' then
       if v_reason is null or en.status<>'eliminated' or a.status<>'open' then raise exception 'Solo puede reabrir eliminados de un área abierta, con motivo'; end if;
       update public.competition_entries set status='active' where id=en.id;
     else
       select * into e from public.competition_evaluations where entry_id=en.id and timer_status in ('pending','running','paused','stopped');
       if found then return to_jsonb(e)||jsonb_build_object('server_now',clock_timestamp()); end if;
       if a.status='completed' or (a.status='open' and en.status<>'active') or (a.status='tiebreak_required' and not en.tiebreak_candidate) then raise exception 'La participación no es evaluable'; end if;
       if a.status='tiebreak_required' and exists(select 1 from public.competition_evaluations where entry_id=en.id and is_tiebreaker and tiebreak_round=a.tiebreak_round and timer_status='saved') then raise exception 'Desempate de esta ronda ya evaluado'; end if;
       if (select coalesce(sum(max_score),0) from public.competition_rubric_items where area_id=a.id)<>100 then raise exception 'Rúbrica inválida'; end if;
       insert into public.competition_evaluations(competition_id,entry_id,phase_id,attempt_number,is_tiebreaker,tiebreak_round,minimum_quality,maximum_duration_ms,target_duration_ms,phase_points,allow_pause,evaluated_by)
       values(c.id,en.id,ph.id,(select coalesce(max(attempt_number),0)+1 from public.competition_evaluations where entry_id=en.id and phase_id=ph.id),a.status='tiebreak_required',a.tiebreak_round,a.minimum_quality,a.maximum_duration_ms,a.target_duration_ms,ph.points,c.allow_timer_pause,auth.uid()) returning * into e;
       insert into public.competition_evaluation_scores(evaluation_id,competition_id,rubric_item_id,label,max_score,sort_order) select e.id,c.id,id,label,max_score,sort_order from public.competition_rubric_items where area_id=a.id;
       v_id:=e.id; v_result:=to_jsonb(e);
     end if;
   elsif p_action in ('start','stop','pause','resume','cancel','finalize','correct') then
     if c.status<>'active' then raise exception 'El concurso no está activo'; end if;
     select * into e from public.competition_evaluations where id=(p_payload->>'evaluation_id')::uuid and competition_id=c.id for update;
     if not found then raise exception 'Evaluación inexistente'; end if;
     select * into en from public.competition_entries where id=e.entry_id;
     v_id:=e.id; v_old:=to_jsonb(e); v_now:=clock_timestamp();
     if p_action='start' then
       if e.timer_status<>'pending' then raise exception 'El cronómetro ya fue iniciado'; end if;
       update public.competition_evaluations set started_at=v_now,started_by=auth.uid(),timer_status='running' where id=e.id;
     elsif p_action='pause' then
       if e.timer_status<>'running' or not e.allow_pause then raise exception 'La pausa no está permitida'; end if;
       update public.competition_evaluations set paused_at=v_now,timer_status='paused' where id=e.id;
     elsif p_action='resume' then
       if e.timer_status<>'paused' then raise exception 'El cronómetro no está pausado'; end if;
       update public.competition_evaluations set paused_duration_ms=paused_duration_ms+floor(extract(epoch from(v_now-paused_at))*1000)::bigint,paused_at=null,timer_status='running' where id=e.id;
     elsif p_action='stop' then
       if e.timer_status<>'running' then raise exception 'El cronómetro no está corriendo'; end if;
       update public.competition_evaluations set finished_at=v_now,duration_ms=greatest(0,floor(extract(epoch from(v_now-started_at))*1000)::bigint-paused_duration_ms),timer_status='stopped' where id=e.id;
     elsif p_action='cancel' then
       if e.timer_status='cancelled' then return to_jsonb(e); end if;
       if e.timer_status not in ('pending','running','paused','stopped') or v_reason is null then raise exception 'Se requiere una evaluación abierta y motivo de cancelación'; end if;
       update public.competition_evaluations set finished_at=v_now,timer_status='cancelled' where id=e.id;
     elsif p_action='finalize' then
       if e.timer_status='saved' then return to_jsonb(e); end if;
       if e.timer_status<>'stopped' then raise exception 'Detenga el cronómetro antes de guardar'; end if;
       if coalesce((p_payload->>'critical_error')::boolean,false) and v_reason is null then raise exception 'Indique el motivo del error crítico'; end if;
       if jsonb_typeof(p_payload->'scores') is distinct from 'object' then raise exception 'Rúbrica obligatoria'; end if;
       if (select count(*) from jsonb_object_keys(p_payload->'scores'))<>(select count(*) from public.competition_evaluation_scores where evaluation_id=e.id) then raise exception 'Complete todos los criterios'; end if;
       update public.competition_evaluation_scores set score=(p_payload->'scores'->>rubric_item_id::text)::numeric where evaluation_id=e.id;
       if exists(select 1 from public.competition_evaluation_scores where evaluation_id=e.id and score is null) then raise exception 'Complete todos los criterios'; end if;
       select sum(score) into v_quality from public.competition_evaluation_scores where evaluation_id=e.id;
       v_pass:=v_quality>=e.minimum_quality and e.duration_ms<=e.maximum_duration_ms and not coalesce((p_payload->>'critical_error')::boolean,false);
       update public.competition_evaluations set quality_score=v_quality,critical_error=coalesce((p_payload->>'critical_error')::boolean,false),critical_error_reason=v_reason,approved=v_pass,points_awarded=case when v_pass and not is_tiebreaker then phase_points else 0 end,timer_status='saved',evaluated_by=auth.uid() where id=e.id;
       if not e.is_tiebreaker then
         select id into v_next from public.competition_phases where competition_id=c.id and active and phase_order>(select phase_order from public.competition_phases where id=e.phase_id) order by phase_order limit 1;
         update public.competition_entries set current_phase_id=case when v_pass then coalesce(v_next,e.phase_id) else e.phase_id end,status=case when not v_pass then 'eliminated' when v_next is null then 'finalist' else 'active' end where id=en.id;
         insert into public.audit_log(actor_id,store_id,table_name,record_id,action,old_data,new_data)
         select auth.uid(),c.store_id,'competitions',c.id::text,'UPDATE',to_jsonb(en),jsonb_build_object('competition_id',c.id,'event',case when not v_pass then 'participant_eliminated' when v_next is null then 'participant_finalist' else 'participant_advanced' end,'entry',to_jsonb(x)) from public.competition_entries x where x.id=en.id;
       end if;
     elsif p_action='correct' then
       if v_reason is null or e.timer_status<>'saved' then raise exception 'Seleccione un resultado guardado e indique el motivo'; end if;
       -- Preserve old results in both the immutable audit and voided attempts; derived totals automatically recalculate.
       select jsonb_build_object('evaluation',to_jsonb(e),'affected',jsonb_agg(to_jsonb(ev))) into v_old from public.competition_evaluations ev where ev.entry_id=en.id and ev.created_at>=e.created_at;
       update public.competition_evaluations set timer_status='void',points_awarded=0,updated_at=v_now where entry_id=en.id and created_at>=e.created_at;
       update public.competition_entries set status=case when status='champion' then 'finalist' else status end,champion_points=0,tiebreak_candidate=false where area_id=en.area_id;
       -- A corrected final invalidates the entire old tiebreak tournament.
       update public.competition_evaluations set timer_status='void',points_awarded=0,updated_at=v_now where is_tiebreaker and entry_id in(select id from public.competition_entries where area_id=en.area_id);
       update public.competition_areas set status='open',tiebreak_round=0 where id=en.area_id;
       if not e.is_tiebreaker then update public.competition_entries set current_phase_id=e.phase_id,status='active' where id=en.id; end if;
     end if;
     if p_action in ('start','stop','pause','resume','cancel') then insert into public.competition_timer_events(competition_id,evaluation_id,action,occurred_at,performed_by,reason) values(c.id,e.id,p_action,v_now,auth.uid(),v_reason); end if;
     update public.competition_evaluations set updated_at=v_now where id=e.id returning to_jsonb(competition_evaluations.*) into v_result;
   elsif p_action='champion' then
     if c.status<>'active' then raise exception 'El concurso no está activo'; end if;
     select * into a from public.competition_areas where id=(p_payload->>'area_id')::uuid and competition_id=c.id;
     if not found then raise exception 'Área inexistente'; end if;
     v_id:=a.id; v_old:=to_jsonb(a);
     if a.status='completed' then return to_jsonb(a); end if;
     if not exists(select 1 from public.competition_entries where area_id=a.id) then raise exception 'Área sin participantes'; end if;
     if exists(select 1 from public.competition_entries where area_id=a.id and status='active') or exists(select 1 from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id where x.area_id=a.id and ev.timer_status in ('pending','running','paused','stopped')) then raise exception 'Termine todas las evaluaciones del área'; end if;
     if a.tiebreak_round>0 and exists(select 1 from public.competition_entries x where x.area_id=a.id and x.tiebreak_candidate and not exists(select 1 from public.competition_evaluations ev where ev.entry_id=x.id and ev.is_tiebreaker and ev.tiebreak_round=a.tiebreak_round and ev.timer_status='saved')) then raise exception 'Faltan evaluaciones del desempate'; end if;
     select ev.quality_score,ev.duration_ms into v_top from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id where x.area_id=a.id and x.status='finalist' and ev.timer_status='saved' and ev.approved and ev.phase_id=x.current_phase_id and ((a.tiebreak_round=0 and not ev.is_tiebreaker) or (a.tiebreak_round>0 and x.tiebreak_candidate and ev.is_tiebreaker and ev.tiebreak_round=a.tiebreak_round)) order by ev.quality_score desc,ev.duration_ms limit 1;
     if not found then
       if a.tiebreak_round=0 then update public.competition_areas set status='completed' where id=a.id;
       else update public.competition_areas set tiebreak_round=tiebreak_round+1 where id=a.id; end if;
     else
       select array_agg(x.id) into v_ids from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id where x.area_id=a.id and x.status='finalist' and ev.timer_status='saved' and ev.approved and ev.phase_id=x.current_phase_id and ev.quality_score=v_top.quality_score and ev.duration_ms=v_top.duration_ms and ((a.tiebreak_round=0 and not ev.is_tiebreaker) or (a.tiebreak_round>0 and x.tiebreak_candidate and ev.is_tiebreaker and ev.tiebreak_round=a.tiebreak_round));
       if cardinality(v_ids)=1 then
         update public.competition_entries set status='champion',champion_points=c.champion_bonus,tiebreak_candidate=false where id=v_ids[1];
         update public.competition_areas set status='completed' where id=a.id;
         insert into public.audit_log(actor_id,store_id,table_name,record_id,action,new_data) values(auth.uid(),c.store_id,'competitions',c.id::text,'UPDATE',jsonb_build_object('competition_id',c.id,'event','champion_declared','entry_id',v_ids[1],'area_id',a.id,'bonus',c.champion_bonus));
       else
         update public.competition_entries set tiebreak_candidate=(id=any(v_ids)) where area_id=a.id;
         update public.competition_areas set status='tiebreak_required',tiebreak_round=tiebreak_round+1 where id=a.id;
       end if;
     end if;
     select to_jsonb(ar) into v_result from public.competition_areas ar where id=a.id;
   else raise exception 'Operación de concurso desconocida';
   end if;
 end if;
 update public.competitions set updated_at=clock_timestamp() where id=c.id;
 insert into public.audit_log(actor_id,store_id,table_name,record_id,action,old_data,new_data)
 values(auth.uid(),c.store_id,'competitions',c.id::text,case when p_action='create' then 'INSERT' else 'UPDATE' end,v_old,
 jsonb_build_object('competition_id',c.id,'event',p_action,'entity_id',v_id,'payload',p_payload,'result',v_result));
 return coalesce(v_result,to_jsonb(c))||jsonb_build_object('server_now',clock_timestamp());
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;
create function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select private.competition_command(p_competition_id,p_action,p_payload) $$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
create function public.competition_server_time() returns timestamptz language sql security invoker set search_path='' as $$ select clock_timestamp() $$;
revoke all on function public.competition_server_time() from public,anon;
grant execute on function public.competition_server_time() to authenticated;

create view public.competition_individual_ranking with(security_invoker=true) as
select m.competition_id,m.id member_id,m.staff_id,m.display_name,m.team_id,t.name team_name,t.trainer_staff_id,t.trainer_name,
 count(distinct en.id)::integer areas,
 coalesce((select sum(ev.points_awarded) from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id where x.member_id=m.id and ev.timer_status='saved'),0)+coalesce(sum(en.champion_points),0) points,
 (select round(avg(ev.quality_score),2) from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id where x.member_id=m.id and ev.timer_status='saved' and not ev.is_tiebreaker) average_quality,
 (select max(p.phase_order) from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id join public.competition_phases p on p.id=ev.phase_id where x.member_id=m.id and ev.timer_status='saved' and ev.approved and not ev.is_tiebreaker) max_phase
from public.competition_team_members m join public.competition_teams t on t.id=m.team_id left join public.competition_entries en on en.member_id=m.id group by m.id,t.id;
create view public.competition_team_ranking with(security_invoker=true) as
select t.competition_id,t.id team_id,t.name team_name,t.trainer_staff_id,t.trainer_name,
 coalesce(sum(r.points),0) points,count(r.member_id)::integer members,
 (select count(*) from public.competition_entries x join public.competition_team_members m on m.id=x.member_id where m.team_id=t.id and x.status='champion') champions,
 (select coalesce(jsonb_object_agg(q.name,q.total),'{}'::jsonb) from (select p.name,count(*) total from public.competition_evaluations ev join public.competition_entries x on x.id=ev.entry_id join public.competition_team_members m on m.id=x.member_id join public.competition_phases p on p.id=ev.phase_id where m.team_id=t.id and ev.timer_status='saved' and ev.approved and not ev.is_tiebreaker group by p.name) q) phase_approvals
from public.competition_teams t left join public.competition_individual_ranking r on r.team_id=t.id group by t.id;
create view public.competition_trainer_ranking with(security_invoker=true) as select * from public.competition_team_ranking;
create view public.competition_fixture_view with(security_invoker=true) as
select en.*,m.display_name,m.staff_id,m.team_id,t.name team_name,t.trainer_name,a.name area_name,p.name current_phase_name
from public.competition_entries en join public.competition_team_members m on m.id=en.member_id join public.competition_teams t on t.id=m.team_id join public.competition_areas a on a.id=en.area_id join public.competition_phases p on p.id=en.current_phase_id;
revoke all on public.competition_individual_ranking,public.competition_team_ranking,public.competition_trainer_ranking,public.competition_fixture_view from public,anon,authenticated;
grant select on public.competition_individual_ranking,public.competition_team_ranking,public.competition_trainer_ranking,public.competition_fixture_view to authenticated;
-- One subscription to the parent is sufficient: every successful command updates it transactionally.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='competitions') then
   alter publication supabase_realtime add table public.competitions;
 end if;
end $$;
