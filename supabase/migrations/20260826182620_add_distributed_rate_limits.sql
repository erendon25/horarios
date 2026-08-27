create schema if not exists private;

create table if not exists private.request_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on table private.request_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row private.request_rate_limits%rowtype;
  current_time timestamptz := clock_timestamp();
begin
  if length(trim(p_bucket_key)) < 3 or p_max_requests < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_parameters';
  end if;

  insert into private.request_rate_limits as limits (bucket_key, window_started_at, request_count, updated_at)
  values (trim(p_bucket_key), current_time, 1, current_time)
  on conflict (bucket_key) do update
  set window_started_at = case
        when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time then current_time
        else limits.window_started_at
      end,
      request_count = case
        when limits.window_started_at + make_interval(secs => p_window_seconds) <= current_time then 1
        else limits.request_count + 1
      end,
      updated_at = current_time
  returning * into current_row;

  allowed := current_row.request_count <= p_max_requests;
  retry_after_seconds := case when allowed then 0 else greatest(
    1,
    ceil(extract(epoch from current_row.window_started_at + make_interval(secs => p_window_seconds) - current_time))::integer
  ) end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Distributed fixed-window limiter for trusted server code. Not callable by browser roles.';
