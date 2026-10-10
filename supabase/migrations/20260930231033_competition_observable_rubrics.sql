alter table public.competition_rubric_items add column checklist jsonb not null default '[]'::jsonb;
alter table public.competition_evaluation_scores add column checklist jsonb not null default '[]'::jsonb;
alter table public.competition_evaluation_scores add column checked_steps jsonb not null default '{}'::jsonb;
alter table public.competitions add column checklist_required boolean not null default false;
update public.competitions set checklist_required=true where status='draft';
alter table public.competitions alter column checklist_required set default true;

create function private.competition_validate_checklist(p_checks jsonb,p_max numeric)
returns void language plpgsql immutable set search_path='' as $$
declare step jsonb; total numeric:=0; ids text[]:='{}';
begin
 if jsonb_typeof(p_checks) is distinct from 'array' or jsonb_array_length(p_checks) not between 1 and 30 then raise exception 'Defina entre 1 y 30 comprobaciones por criterio'; end if;
 for step in select value from jsonb_array_elements(p_checks) loop
   if jsonb_typeof(step) is distinct from 'object' or coalesce(step->>'id','') !~ '^[a-zA-Z0-9_-]{1,60}$' or step->>'id'=any(ids)
     or length(trim(coalesce(step->>'label',''))) not between 1 and 1000 or jsonb_typeof(step->'points') is distinct from 'number'
     or (step->>'points')::numeric<=0 or round((step->>'points')::numeric,2)<>(step->>'points')::numeric
     or (step ? 'automatic' and step->>'automatic' is distinct from 'time_limit') then
     raise exception 'Comprobación inválida: identificador único, descripción y puntos positivos con máximo dos decimales';
   end if;
   ids:=array_append(ids,step->>'id'); total:=total+(step->>'points')::numeric;
 end loop;
 if total is distinct from p_max then raise exception 'Los puntos de las comprobaciones deben sumar el máximo del criterio'; end if;
end $$;
revoke all on function private.competition_validate_checklist(jsonb,numeric) from public,anon,authenticated;

create function private.competition_default_checklist(p_area text,p_label text,p_max numeric) returns jsonb language plpgsql immutable set search_path='' as $$
declare templates jsonb := '{"procedures":{"Landing":["Retira el producto del horno con las herramientas correspondientes.","Usa el cortador correspondiente al tipo de pizza.","Realiza la secuencia de cortes correspondiente al producto.","Realiza el empaque correspondiente al pedido.","Marca el vencimiento del producto terminado."],"Landing Crazy":["Transfiere el producto a la bandeja con la herramienta correspondiente.","Aplica el spread correspondiente al producto.","Aplica el acabado correspondiente al producto elegido.","Transfiere el producto al papel o envase correspondiente.","Envuelve, embolsa y marca el producto según corresponda."],"Vestido":["Selecciona la base correspondiente al producto.","Aplica la salsa correspondiente.","Aplica el queso correspondiente.","Coloca los ingredientes correspondientes al producto.","Traslada el producto al ready rack e inicia su control de tiempo."],"Sheetout":["Selecciona la masa con maduración y rotación correspondientes.","Prepara el molde con corn meal.","Retira y enharina la bola de masa con las herramientas correspondientes.","Forma el borde y realiza los pases por el sheeter correspondientes.","Estira y coloca el sheetout en el molde con la orientación correspondiente."],"Masa":["Identifica los ingredientes de la receta correspondiente.","Prepara la mezcla siguiendo la secuencia de la receta.","Divide la masa en los bollos correspondientes.","Realiza el boleado y coloca los bollos en la bandeja.","Fecha y traslada la masa a la cámara aplicando rotación."],"Drive Thru":["Saluda y recibe el pedido del cliente.","Confirma el pedido antes de registrarlo.","Registra el pedido en el canal correspondiente.","Confirma el pago y el comprobante.","Entrega el pedido y cierra la atención."],"Servicio":["Recibe al cliente y solicita su pedido.","Confirma la orden antes de registrarla.","Registra los productos solicitados.","Confirma el pago y el comprobante.","Informa el tiempo de entrega y cierra la atención."]},"criteria":{"Porcionamiento / cantidades":["Usa la medida indicada para la base o porción principal.","Usa la cantidad indicada del primer insumo de la receta.","Usa la cantidad indicada del segundo insumo de la receta.","Usa las cantidades indicadas de los complementos.","El resultado contiene todas las porciones requeridas, sin sobrantes ni faltantes."],"Presentación":["El producto conserva la forma requerida.","La distribución visible de los ingredientes es uniforme.","El producto no presenta roturas o deformaciones.","El envase o empaque está limpio y correctamente cerrado.","El acabado corresponde al producto solicitado."],"Presentación / orden":["El producto presenta el acabado requerido.","El empaque está limpio y cerrado.","El pedido se presenta organizado.","Los productos y complementos están identificados.","La zona de entrega queda ordenada."],"Técnica":["Sujeta y controla las herramientas durante la ejecución.","Ejecuta los movimientos sin dañar el producto.","Mantiene la uniformidad durante la ejecución.","Resuelve el ejercicio sin maniobras que requieran rehacer el producto.","Termina la operación con el producto íntegro."],"Orden y limpieza":["El área está limpia al comenzar.","Los utensilios están limpios y listos.","Los insumos están ordenados durante el ejercicio.","Retira los residuos generados.","Limpia y ordena el área al finalizar."],"Orden":["Prepara los elementos necesarios antes de empezar.","Mantiene organizados los pedidos o productos.","Mantiene despejada el área de trabajo.","Retira los elementos que ya no utiliza.","Deja ordenada la estación al finalizar."],"Seguridad/manipulación":["Realiza la higiene de manos correspondiente.","Evita el contacto del alimento con superficies no sanitizadas.","Usa las herramientas y protección correspondientes.","Evita la contaminación cruzada.","Mantiene los controles de conservación que corresponden al producto."],"Exactitud del pedido":["El producto principal coincide con la orden.","La cantidad de unidades coincide con la orden.","Los ingredientes o modificaciones coinciden con la orden.","Las bebidas o complementos coinciden con la orden.","Confirma el pedido completo antes de entregarlo."],"Exactitud":["Identifica el producto solicitado.","Confirma la cantidad solicitada.","Registra las modificaciones solicitadas.","Registra los complementos solicitados.","Verifica que el registro final coincide con lo confirmado por el cliente."],"Entrega correcta":["Entrega el pedido al cliente correspondiente.","Entrega todos los productos de la orden.","Entrega todos los complementos requeridos.","Entrega el comprobante correspondiente.","Verifica con el cliente la entrega del pedido completo."],"Atención":["Saluda al cliente al iniciar.","Escucha el pedido sin interrumpir.","Responde las consultas del cliente.","Informa de forma clara el pedido y el tiempo de entrega.","Agradece e invita al cliente a regresar."],"Atención / comunicación":["Saluda y establece contacto con el cliente.","Escucha y confirma el pedido.","Comunica claramente las indicaciones necesarias.","Informa el tiempo de entrega.","Agradece y cierra la atención."]}}'::jsonb; labels jsonb; result jsonb:='[]'; item text; idx integer:=0; n integer; base numeric;
begin
 if p_label in ('Tiempo','Rapidez') then return jsonb_build_array(jsonb_build_object('id','tiempo','label','El tiempo registrado no supera el máximo del área.','points',p_max,'automatic','time_limit')); end if;
 labels:=case when p_label in ('Procedimiento correcto','Procedimiento') then templates->'procedures'->p_area else templates->'criteria'->p_label end;
 if labels is null then return '[]'::jsonb; end if;
 n:=jsonb_array_length(labels);
 if p_max<.05 then return jsonb_build_array(jsonb_build_object('id','paso_1','label',labels->>0,'points',p_max)); end if;
 base:=floor(p_max*100/n)/100;
 for item in select value from jsonb_array_elements_text(labels) loop
   idx:=idx+1; result:=result||jsonb_build_array(jsonb_build_object('id','paso_'||idx,'label',item,'points',case when idx=n then p_max-base*(n-1) else base end));
 end loop;
 return result;
end $$;
revoke all on function private.competition_default_checklist(text,text,numeric) from public,anon,authenticated;

-- Only draft rubrics receive defaults; existing evaluation snapshots stay intact.
update public.competition_rubric_items ri set checklist=private.competition_default_checklist(a.name,ri.label,ri.max_score)
from public.competition_areas a join public.competitions c on c.id=a.competition_id
where ri.area_id=a.id and c.status='draft';

create function private.competition_snapshot_checklist() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select checklist into new.checklist from public.competition_rubric_items where id=new.rubric_item_id and competition_id=new.competition_id;
 new.checklist:=coalesce(new.checklist,'[]'::jsonb);
 return new;
end $$;
revoke all on function private.competition_snapshot_checklist() from public,anon,authenticated;
create trigger competition_score_checklist_snapshot before insert on public.competition_evaluation_scores for each row execute function private.competition_snapshot_checklist();

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_checklists;
revoke all on function private.competition_command_before_checklists(uuid,text,jsonb) from public,anon,authenticated;
create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.competitions%rowtype; e public.competition_evaluations%rowtype;
 r record; item jsonb; step jsonb; decisions jsonb; calculated jsonb:='{}'::jsonb;
 score numeric; fulfilled boolean; result jsonb; idx integer:=0; v_role public.app_role:=private.current_user_role();
begin
 if p_action in ('rubric','prepare','finalize','status') then
   if auth.uid() is null or v_role is null or v_role not in ('admin','superadmin') then raise exception 'Solo administradores activos pueden gestionar concursos' using errcode='42501'; end if;
   select * into c from public.competitions where id=p_competition_id for update;
   if not found then raise exception 'Concurso no disponible'; end if;
   if v_role<>'superadmin' and c.store_id is distinct from private.current_user_store_id() then raise exception 'Tienda no autorizada' using errcode='42501'; end if;
 end if;
 if p_action='status' and p_payload->>'status'='active' and c.checklist_required then
   for r in select ri.checklist,ri.max_score from public.competition_rubric_items ri join public.competition_areas a on a.id=ri.area_id where a.competition_id=c.id and a.active loop
     perform private.competition_validate_checklist(r.checklist,r.max_score);
   end loop;
 end if;
 if p_action='rubric' then
   if jsonb_typeof(p_payload->'items') is distinct from 'array' then raise exception 'Rúbrica obligatoria'; end if;
   for item in select value from jsonb_array_elements(p_payload->'items') loop
     perform private.competition_validate_checklist(item->'checklist',(item->>'max_score')::numeric);
   end loop;
   result:=private.competition_command_before_checklists(p_competition_id,p_action,p_payload);
   for r in select id from public.competition_rubric_items where area_id=(p_payload->>'area_id')::uuid and competition_id=c.id order by sort_order loop
     update public.competition_rubric_items set checklist=p_payload->'items'->idx->'checklist' where id=r.id;
     idx:=idx+1;
   end loop;
   return result;
 elsif p_action='prepare' then
   if exists(select 1 from public.competition_evaluations where entry_id=(p_payload->>'entry_id')::uuid and competition_id=c.id and timer_status in ('pending','running','paused','stopped')) then
     return private.competition_command_before_checklists(p_competition_id,p_action,p_payload);
   end if;
   -- Active legacy contests keep their already configured manual rubric.
   for r in select ri.checklist,ri.max_score from public.competition_rubric_items ri join public.competition_entries en on en.area_id=ri.area_id where en.id=(p_payload->>'entry_id')::uuid and en.competition_id=c.id loop
     if c.checklist_required or jsonb_array_length(r.checklist)>0 then perform private.competition_validate_checklist(r.checklist,r.max_score); end if;
   end loop;
 elsif p_action='finalize' then
   select * into e from public.competition_evaluations where id=(p_payload->>'evaluation_id')::uuid and competition_id=c.id for update;
   if not found then raise exception 'Evaluación no disponible'; end if;
   if e.timer_status='saved' then return private.competition_command_before_checklists(p_competition_id,p_action,p_payload); end if;
   if e.timer_status<>'stopped' then raise exception 'Detenga el cronómetro antes de guardar'; end if;
   for r in select * from public.competition_evaluation_scores where evaluation_id=e.id loop
     if jsonb_array_length(r.checklist)=0 then
       calculated:=calculated||jsonb_build_object(r.rubric_item_id::text,p_payload->'scores'->r.rubric_item_id::text);
       continue;
     end if;
     decisions:=p_payload->'checks'->r.rubric_item_id::text;
     if jsonb_typeof(decisions) is distinct from 'object' or (select count(*) from jsonb_object_keys(decisions))<>jsonb_array_length(r.checklist) then raise exception 'Evalúe todas las comprobaciones'; end if;
     score:=0;
     for step in select value from jsonb_array_elements(r.checklist) loop
       if jsonb_typeof(decisions->(step->>'id')) is distinct from 'boolean' then raise exception 'Indique Cumple o No cumple para cada comprobación'; end if;
       fulfilled:=case when step->>'automatic'='time_limit' then e.duration_ms<=e.maximum_duration_ms else (decisions->>(step->>'id'))::boolean end;
       decisions:=jsonb_set(decisions,array[step->>'id'],to_jsonb(fulfilled));
       if fulfilled then score:=score+(step->>'points')::numeric; end if;
     end loop;
     calculated:=calculated||jsonb_build_object(r.rubric_item_id::text,score);
     update public.competition_evaluation_scores set checked_steps=decisions where evaluation_id=e.id and rubric_item_id=r.rubric_item_id;
   end loop;
   return private.competition_command_before_checklists(p_competition_id,p_action,jsonb_set(p_payload,'{scores}',calculated));
 end if;
 result:=private.competition_command_before_checklists(p_competition_id,p_action,p_payload);
 if p_action='create' then
   update public.competition_rubric_items ri set checklist=private.competition_default_checklist(a.name,ri.label,ri.max_score)
   from public.competition_areas a where ri.area_id=a.id and a.competition_id=(result->>'id')::uuid;
 end if;
 return result;
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;
create or replace function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.competition_command(p_competition_id,p_action,p_payload)$$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
