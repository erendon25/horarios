-- Keep team leaders as observers. Identity comes from the authenticated account,
-- not the account role or IDs supplied by the client. Existing results survive.
do $$
declare
 definition text := pg_get_functiondef('private.competition_command_before_publication(uuid,text,jsonb)'::regprocedure);
 marker text := 'v_staff:=private.current_staff_profile_id();';
 guard text := $guard$
   if p_action='register' and exists (
     select 1 from public.competition_teams t
     where t.competition_id=c.id and t.trainer_staff_id=v_staff
   ) then
     raise exception 'Los líderes de equipo no se inscriben; solo hacen seguimiento a sus colaboradores'
       using errcode='42501';
   end if;
$guard$;
begin
 if (length(definition)-length(replace(definition,marker,'')))/length(marker) <> 1 then
   raise exception 'No se encontró una única comprobación de identidad para la inscripción';
 end if;
 execute replace(definition,marker,marker||guard);
end $$;
revoke all on function private.competition_command_before_publication(uuid,text,jsonb)
 from public,anon,authenticated;
notify pgrst,'reload schema';
