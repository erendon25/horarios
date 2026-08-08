-- ============================================================
-- DEPURAR PERSONAL QUE NO DEBE APARECER (historicos, Abigail, trainees)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Marcar status='inactive' los oculta de TODOS los paneles
-- (entrenamiento, horarios, admin) porque isStaffActive filtra inactivos.
-- ============================================================

-- ------------------------------------------------------------
-- 1) DIAGNÓSTICO (solo lectura) — mira por qué siguen apareciendo
-- ------------------------------------------------------------

-- 1a. Perfiles "HISTORICO ..." (placeholders reconstruidos)
select id, first_name, last_name, status, position, is_trainee, cessation_date
from public.staff_profiles
where first_name ilike 'historico%'
   or (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ilike 'historico%'
order by first_name;

-- 1b. Abigail
select id, first_name, last_name, status, position, is_trainee, cessation_date, training_end_date
from public.staff_profiles
where (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ilike '%abigail%limas%suca%';

-- 1c. Todos los marcados como trainee (revisa cuáles son reales vs viejos)
select id, first_name, last_name, status, position, training_end_date, cessation_date
from public.staff_profiles
where is_trainee = true
order by training_end_date nulls last, first_name;


-- ------------------------------------------------------------
-- 2) FIXES SEGUROS — descomenta y ejecuta tras revisar el diagnóstico
-- ------------------------------------------------------------

-- 2a. Marcar INACTIVOS todos los perfiles HISTORICO (placeholders):
-- update public.staff_profiles
-- set status = 'inactive', updated_at = now()
-- where first_name ilike 'historico%'
--    or (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ilike 'historico%';

-- 2b. Marcar INACTIVA a Abigail:
-- update public.staff_profiles
-- set status = 'inactive', updated_at = now()
-- where (coalesce(first_name,'') || ' ' || coalesce(last_name,'')) ilike '%abigail%limas%suca%';


-- ------------------------------------------------------------
-- 3) TRAINEES — ⚠️ decide con criterio (ver 1c primero)
-- ------------------------------------------------------------

-- 3a. Marcar inactivos SOLO los trainees cuya fecha de fin ya pasó
--     (recomendado: no toca a los trainees actuales):
-- update public.staff_profiles
-- set status = 'inactive', updated_at = now()
-- where is_trainee = true
--   and training_end_date is not null
--   and training_end_date < current_date;

-- 3b. Marcar inactivos TODOS los trainees (úsalo solo si de verdad
--     ninguno debe aparecer):
-- update public.staff_profiles
-- set status = 'inactive', updated_at = now()
-- where is_trainee = true;
