-- Read-only deployment checks: no identity changes and no production fixtures.
select c.relname as table_name,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
 has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') as direct_writes
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and (c.relname='competitions' or c.relname like 'competition_%')
order by c.relname;
select c.relname,c.reloptions from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='v' and c.relname like 'competition_%';
select n.nspname,p.proname,p.prosecdef,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('competition_command','competition_server_time');
select * from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='competitions';
