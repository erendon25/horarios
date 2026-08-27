-- Browser RPC wrappers run as the signed-in role and call explicitly granted
-- helpers in `private`. The distributed rate-limit migration revoked schema
-- USAGE from `authenticated`, so PostgreSQL rejected those RPCs before their
-- authorization checks could run.
--
-- USAGE only allows resolving objects in the schema. Object-level privileges
-- remain unchanged; in particular, authenticated users still cannot access
-- private.request_rate_limits.
grant usage on schema private to authenticated;

revoke all on table private.request_rate_limits from public, anon, authenticated;
