-- ============================================================
-- VERIFICACIÓN DE MIGRACIÓN FIREBASE → SUPABASE
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- (El SQL Editor usa el rol service_role: ignora RLS y ve todo)
--
-- Compara "actual" (lo que hay en Supabase) contra "esperado"
-- (conteos del reporte de transformación del 2026-08-05).
-- Cualquier fila con estado FALTA o INCOMPLETO indica datos sin migrar.
-- ============================================================

with esperado (tabla, esperado) as (
  values
    ('stores', 7),
    ('user_profiles', 156),
    ('staff_profiles', 271),
    ('staff_skills', 237),
    ('store_positions', 104),
    ('store_positioning_requirements', 36),
    ('schedule_weeks', 2929),
    ('schedule_shifts', 15836),
    ('study_schedule_days', 1092),
    ('study_schedule_blocks', 752),
    ('worked_holidays', 316),
    ('extra_hours', 384),
    ('cessations', 48),
    ('schedule_requests', 78),
    ('training_evaluations', 12),
    ('store_configs', 4),
    ('sales_month_configs', 8),
    ('sales_daily_history', 192),
    ('sales_hourly_history', 2934),
    ('sales_projection_templates', 1)
),
actual (tabla, actual) as (
  select 'stores', count(*) from public.stores
  union all select 'user_profiles', count(*) from public.user_profiles
  union all select 'staff_profiles', count(*) from public.staff_profiles
  union all select 'staff_skills', count(*) from public.staff_skills
  union all select 'store_positions', count(*) from public.store_positions
  union all select 'store_positioning_requirements', count(*) from public.store_positioning_requirements
  union all select 'schedule_weeks', count(*) from public.schedule_weeks
  union all select 'schedule_shifts', count(*) from public.schedule_shifts
  union all select 'study_schedule_days', count(*) from public.study_schedule_days
  union all select 'study_schedule_blocks', count(*) from public.study_schedule_blocks
  union all select 'worked_holidays', count(*) from public.worked_holidays
  union all select 'extra_hours', count(*) from public.extra_hours
  union all select 'cessations', count(*) from public.cessations
  union all select 'schedule_requests', count(*) from public.schedule_requests
  union all select 'training_evaluations', count(*) from public.training_evaluations
  union all select 'store_configs', count(*) from public.store_configs
  union all select 'sales_month_configs', count(*) from public.sales_month_configs
  union all select 'sales_daily_history', count(*) from public.sales_daily_history
  union all select 'sales_hourly_history', count(*) from public.sales_hourly_history
  union all select 'sales_projection_templates', count(*) from public.sales_projection_templates
)
select
  e.tabla,
  e.esperado,
  coalesce(a.actual, 0) as actual,
  coalesce(a.actual, 0) - e.esperado as diferencia,
  case
    when coalesce(a.actual, 0) = 0 and e.esperado > 0 then '❌ FALTA (0 filas)'
    when coalesce(a.actual, 0) < e.esperado then '⚠️ INCOMPLETO'
    when coalesce(a.actual, 0) = e.esperado then '✅ OK'
    else 'ℹ️ MÁS QUE ESPERADO'
  end as estado
from esperado e
left join actual a using (tabla)
order by
  case
    when coalesce(a.actual, 0) = 0 and e.esperado > 0 then 0
    when coalesce(a.actual, 0) < e.esperado then 1
    else 2
  end,
  e.tabla;

-- ============================================================
-- CHEQUEO 2: Colaboradores sin cuenta / sin rol / sin poder entrar
-- ============================================================

-- 2a. Perfiles de personal ACTIVOS que NO tienen user_profile vinculado
--     (no podrán iniciar sesión nunca)
select 'staff_activo_sin_user_profile' as chequeo, count(*) as cantidad
from public.staff_profiles sp
where coalesce(sp.status, 'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
  and not exists (
    select 1 from public.user_profiles up where up.id = sp.user_id
  );

-- 2b. user_profiles con rol nulo o inválido (caen en "Rol no reconocido")
select 'user_profiles_rol_invalido' as chequeo, count(*) as cantidad
from public.user_profiles
where role is null
   or role not in ('superadmin', 'admin', 'trainer', 'collaborator');

-- 2c. user_profiles con status distinto de 'active' (bloqueados para entrar)
select 'user_profiles_status_no_active' as chequeo, count(*) as cantidad
from public.user_profiles
where status is distinct from 'active';

-- 2d. Cuentas auth SIN contraseña (encrypted_password nulo/vacío):
--     estas personas NO pueden iniciar sesión con email+clave y
--     necesitan un correo de "restablecer contraseña".
select 'auth_users_sin_password' as chequeo, count(*) as cantidad
from auth.users
where encrypted_password is null or encrypted_password = '';

-- 2e. Detalle: lista de personal activo que no puede entrar
select
  sp.first_name, sp.last_name, sp.position, sp.modality,
  up.role, up.status,
  (u.encrypted_password is null or u.encrypted_password = '') as sin_password
from public.staff_profiles sp
left join public.user_profiles up on up.id = sp.user_id
left join auth.users u on u.id = sp.user_id
where coalesce(sp.status, 'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
  and (
    up.id is null
    or up.role is null
    or up.role not in ('superadmin','admin','trainer','collaborator')
    or up.status is distinct from 'active'
    or u.encrypted_password is null
    or u.encrypted_password = ''
  )
order by sp.last_name, sp.first_name;
