create or replace function private.prevent_external_identifier_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  column_name text := tg_argv[0];
  new_value text := to_jsonb(new) ->> column_name;
  old_value text;
begin
  if tg_op = 'INSERT' then
    if new_value is not null then
      raise exception 'Los identificadores externos ya no están permitidos.'
        using errcode = '23514';
    end if;
    return new;
  end if;

  old_value := to_jsonb(old) ->> column_name;
  if new_value is not null and new_value is distinct from old_value then
    raise exception 'Los identificadores externos ya no están permitidos.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('firestore_id', 'firebase_uid')
  loop
    execute format(
      'alter table public.%I drop constraint if exists %I',
      target.table_name,
      target.table_name || '_no_new_external_id'
    );
    execute format(
      'drop trigger if exists prevent_external_identifier_write on public.%I',
      target.table_name
    );
    execute format(
      'create trigger prevent_external_identifier_write before insert or update of %I on public.%I for each row execute function private.prevent_external_identifier_write(%L)',
      target.column_name,
      target.table_name,
      target.column_name
    );
  end loop;
end;
$$;

revoke all on function private.prevent_external_identifier_write() from public, anon, authenticated;
