-- ============================================================
-- (1) DIAGNÓSTICO DE VÍNCULOS POR COLABORADOR
-- (2) BORRADO DE TODO EL PERSONAL DE LA TIENDA "MISTI"
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================


-- ============================================================
-- PARTE 1 — ¿Qué información tiene enlazada cada colaborador?
-- Solo lectura. Muestra TRUE/FALSE por tipo de dato.
--   training        = tiene posiciones validadas (staff_skills)
--   fecha_cese      = cessation_date cargada
--   cambio_modalidad= modality_change_date + next_modality
--   modalidad       = modality (Full/Part) cargada
--   carnet_sanidad  = sanitary_card_expiry cargada
--   horario_estudio = tiene días de horario de estudio
--   horario_trabajo = tiene semanas de horario laboral
-- ============================================================
select
  s.name as tienda,
  sp.first_name,
  sp.last_name,
  sp.position,
  coalesce(sp.modality, '—')                              as modalidad,
  (exists (select 1 from public.staff_skills k where k.staff_id = sp.id))                 as training,
  (sp.cessation_date is not null)                                                          as fecha_cese,
  (sp.modality_change_date is not null and sp.next_modality is not null)                   as cambio_modalidad,
  (sp.modality is not null)                                                                as tiene_modalidad,
  (sp.sanitary_card_expiry is not null)                                                    as carnet_sanidad,
  (exists (select 1 from public.study_schedule_days d where d.staff_id = sp.id))           as horario_estudio,
  (exists (select 1 from public.schedule_weeks w where w.staff_id = sp.id))               as horario_trabajo
from public.staff_profiles sp
left join public.stores s on s.id = sp.store_id
where coalesce(sp.status,'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
order by s.name nulls first, sp.last_name, sp.first_name;

-- 1b. Conteo real de cada tipo (por si quieres el detalle numérico de uno):
--     Cambia el email por el del colaborador que quieras inspeccionar.
-- select
--   sp.first_name, sp.last_name,
--   (select count(*) from public.staff_skills k where k.staff_id = sp.id)        as skills,
--   (select count(*) from public.schedule_weeks w where w.staff_id = sp.id)      as semanas_horario,
--   (select count(*) from public.study_schedule_days d where d.staff_id = sp.id) as dias_estudio,
--   (select count(*) from public.worked_holidays h where h.staff_id = sp.id)     as feriados,
--   (select count(*) from public.extra_hours e where e.staff_id = sp.id)         as horas_extra
-- from public.staff_profiles sp
-- where lower(sp.email) = lower('correo@ejemplo.com');


-- ============================================================
-- PARTE 2 — BORRAR TODO EL PERSONAL DE "MISTI"
-- ⚠️ DESTRUCTIVO. Sigue los pasos EN ORDEN.
-- Por FK on delete cascade, al borrar el staff_profile se eliminan
-- automáticamente: horarios (schedule_weeks/shifts), estudios,
-- feriados, horas extra, ceses, skills y evaluaciones de esa persona.
-- ============================================================

-- 2a. PRIMERO identifica la tienda Misti (revisa el id y el nombre exacto):
select id, name, city from public.stores where name ilike '%misti%';

-- 2b. PREVIEW: lista COMPLETA del personal que se borraría de Misti.
--     Revisa esta lista con cuidado antes de continuar.
select
  sp.id, sp.first_name, sp.last_name, sp.position, sp.modality, sp.email,
  up.role,
  (sp.user_id is not null) as tiene_cuenta
from public.staff_profiles sp
join public.stores s on s.id = sp.store_id
left join public.user_profiles up on up.id = sp.user_id
where s.name ilike '%misti%'
order by sp.last_name, sp.first_name;

-- 2c. SEGURIDAD: confirma que NINGÚN superadmin caería en el borrado.
--     Si esta consulta devuelve filas, DETENTE y avísame.
select sp.first_name, sp.last_name, up.role
from public.staff_profiles sp
join public.stores s on s.id = sp.store_id
join public.user_profiles up on up.id = sp.user_id
where s.name ilike '%misti%' and up.role = 'superadmin';

-- ------------------------------------------------------------
-- 2d. BORRADO REAL — descomenta y ejecuta SOLO tras revisar 2b y 2c.
--     Paso 1: guardar los user_id de las cuentas a eliminar.
--     Paso 2: borrar los staff_profiles (cascada de datos operativos).
--     Paso 3: borrar las cuentas auth (cascada de user_profiles).
-- ------------------------------------------------------------

-- with misti as (
--   select id from public.stores where name ilike '%misti%'
-- ),
-- cuentas as (
--   select sp.user_id
--   from public.staff_profiles sp
--   join misti m on m.id = sp.store_id
--   join public.user_profiles up on up.id = sp.user_id
--   where sp.user_id is not null and up.role <> 'superadmin'
-- )
-- delete from public.staff_profiles sp
-- using misti m
-- where sp.store_id = m.id;
--
-- -- Elimina las cuentas auth asociadas (cascada borra sus user_profiles).
-- -- Excluye superadmin por seguridad.
-- delete from auth.users u
-- where u.id in (
--   select up.id from public.user_profiles up
--   left join public.staff_profiles sp on sp.user_id = up.id
--   where sp.id is null            -- ya sin staff (recién borrado)
--     and up.role <> 'superadmin'
--     and up.store_id = (select id from public.stores where name ilike '%misti%')
-- );

-- 2e. VERIFICACIÓN post-borrado (debe devolver 0):
-- select count(*) as personal_misti_restante
-- from public.staff_profiles sp
-- join public.stores s on s.id = sp.store_id
-- where s.name ilike '%misti%';
