-- ============================================================
-- BACKFILL DE HABILIDADES (position_abilities)
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- La migración separó las habilidades en dos lugares:
--   - staff_profiles.position_abilities  ← campo Firebase "positionAbilities"
--   - tabla staff_skills                 ← campo Firebase "skills" (las reales)
-- La app lee/escribe SIEMPRE en position_abilities, por eso las habilidades
-- migradas a staff_skills no se ven. Este script las copia de vuelta.
-- ============================================================

-- 1. Ver a cuántos les falta (position_abilities vacío pero con staff_skills):
select count(*) as perfiles_por_corregir
from public.staff_profiles sp
where jsonb_array_length(coalesce(sp.position_abilities, '[]'::jsonb)) = 0
  and exists (select 1 from public.staff_skills sk where sk.staff_id = sp.id);

-- 2. Backfill: copia los skill_code de staff_skills a position_abilities
--    solo cuando la columna está vacía (no pisa lo ya cargado). Idempotente.
update public.staff_profiles sp
set position_abilities = sub.skills,
    updated_at = now()
from (
  select staff_id, jsonb_agg(distinct skill_code) as skills
  from public.staff_skills
  group by staff_id
) sub
where sp.id = sub.staff_id
  and jsonb_array_length(coalesce(sp.position_abilities, '[]'::jsonb)) = 0;

-- 3. Verifica un colaborador puntual (cambia el correo):
-- select first_name, last_name, position_abilities
-- from public.staff_profiles
-- where lower(email) = lower('correo@ejemplo.com');
