-- Habilita las alertas de cambios de horarios de estudio para la pantalla semanal.
-- Realtime sigue respetando las políticas RLS de study_schedule_days.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'study_schedule_days'
  ) then
    alter publication supabase_realtime add table public.study_schedule_days;
  end if;
end
$$;
