-- Preparing and activating a contest does not publish it to employees.
-- Existing contests are deliberately hidden until an administrator publishes.
alter table public.competitions add column published_at timestamptz;

drop policy competition_read on public.competitions;
create policy competition_read on public.competitions for select to authenticated using (
 (select private.current_user_role()) = 'superadmin' or
 (store_id = (select private.current_user_store_id()) and
  ((select private.current_user_role()) = 'admin' or
   ((select private.current_user_role()) is not null and published_at is not null)))
);
-- Child-table policies and security-invoker views inherit this visibility rule.

alter function private.competition_command(uuid,text,jsonb) rename to competition_command_before_publication;
revoke all on function private.competition_command_before_publication(uuid,text,jsonb) from public,anon,authenticated;

create function private.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 c public.competitions%rowtype;
 v_role public.app_role := private.current_user_role();
 v_old jsonb;
begin
 if auth.uid() is null or v_role is null then
   raise exception 'Sesión activa requerida' using errcode='42501';
 end if;
 if p_action='create' then
   return private.competition_command_before_publication(p_competition_id,p_action,p_payload);
 end if;
 select * into c from public.competitions where id=p_competition_id for update;
 if not found then raise exception 'Concurso no disponible'; end if;
 if v_role<>'superadmin' and c.store_id is distinct from private.current_user_store_id() then
   raise exception 'Tienda no autorizada' using errcode='42501';
 end if;
 if v_role not in ('admin','superadmin') and c.published_at is null then
   raise exception 'Concurso no disponible' using errcode='42501';
 end if;
 if p_action='publication' then
   if v_role not in ('admin','superadmin') then
     raise exception 'Solo administradores pueden publicar concursos' using errcode='42501';
   end if;
   if jsonb_typeof(p_payload->'published') is distinct from 'boolean' then
     raise exception 'Indique si desea publicar u ocultar el concurso';
   end if;
   v_old:=to_jsonb(c);
   update public.competitions
   set published_at=case when (p_payload->>'published')::boolean then coalesce(published_at,clock_timestamp()) else null end,
       updated_at=clock_timestamp()
   where id=c.id returning * into c;
   insert into public.audit_log(actor_id,store_id,table_name,record_id,action,old_data,new_data)
   values(auth.uid(),c.store_id,'competitions',c.id::text,'UPDATE',v_old,
     jsonb_build_object('competition_id',c.id,'event','publication','published',c.published_at is not null));
   return to_jsonb(c)||jsonb_build_object('server_now',clock_timestamp());
 end if;
 return private.competition_command_before_publication(p_competition_id,p_action,p_payload);
end $$;
revoke all on function private.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function private.competition_command(uuid,text,jsonb) to authenticated;

-- Rebind the public entry point to the guarded command after the rename.
create or replace function public.competition_command(p_competition_id uuid,p_action text,p_payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select private.competition_command(p_competition_id,p_action,p_payload)
$$;
revoke all on function public.competition_command(uuid,text,jsonb) from public,anon;
grant execute on function public.competition_command(uuid,text,jsonb) to authenticated;
