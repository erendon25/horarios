-- ============================================================
-- RE-ENLACE DE ACCESOS + DEPURACIÓN DE PERSONAL
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- ⚠️ ORDEN DE USO:
--   1) Corre SOLO la SECCIÓN A (diagnóstico, no cambia nada) y revísala.
--   2) Si el diagnóstico se ve bien, corre la SECCIÓN B (re-enlace).
--   3) La SECCIÓN C (borrado) viene COMENTADA. Descoméntala solo tras
--      revisar A3/A4 y estar seguro.
--
-- Modelo de datos:
--   auth.users(id, email, encrypted_password)
--   user_profiles(id = auth.users.id, role, status, store_id, staff_profile_id)
--   staff_profiles(id, user_id → auth.users.id, store_id, email, position)
-- Acceso al panel = auth.users con password + user_profiles con role+status
--                   + staff_profiles.user_id enlazado.
-- ============================================================


-- ============================================================
-- SECCIÓN A — DIAGNÓSTICO (solo lectura, seguro)
-- ============================================================

-- A1. Personal activo SIN user_id, pero cuyo email SÍ existe en auth.users
--     → RE-ENLAZABLE por email (único match). Estos recuperan acceso.
select
  s.name as tienda, sp.first_name, sp.last_name, sp.position, sp.email,
  au.id as auth_user_id,
  (au.encrypted_password is not null and au.encrypted_password <> '') as tiene_password
from public.staff_profiles sp
join public.stores s on s.id = sp.store_id
join auth.users au on lower(au.email) = lower(sp.email)
where sp.user_id is null
  and sp.email is not null and sp.email <> ''
  and coalesce(sp.status,'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
  -- solo emails que apuntan a exactamente UNA cuenta auth (evita ambigüedad)
  and (select count(*) from auth.users x where lower(x.email) = lower(sp.email)) = 1
order by s.name, sp.last_name;

-- A2. Personal activo con user_id enlazado a auth, pero SIN user_profiles
--     → hay cuenta, falta el perfil de rol/status. Se crea en B2.
select
  s.name as tienda, sp.first_name, sp.last_name, sp.position, sp.user_id
from public.staff_profiles sp
join public.stores s on s.id = sp.store_id
join auth.users au on au.id = sp.user_id
left join public.user_profiles up on up.id = sp.user_id
where up.id is null
  and coalesce(sp.status,'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
order by s.name, sp.last_name;

-- A3. Personal activo SIN user_id y SIN email en auth
--     → nunca tuvieron cuenta. Deben auto-registrarse (no se pueden re-enlazar).
select
  s.name as tienda, sp.first_name, sp.last_name, sp.position, sp.email
from public.staff_profiles sp
join public.stores s on s.id = sp.store_id
where sp.user_id is null
  and coalesce(sp.status,'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date)
  and not exists (select 1 from auth.users au where lower(au.email) = lower(coalesce(sp.email,'')))
order by s.name, sp.last_name;

-- A4. Personal activo SIN tienda asignada → candidatos a DEPURAR (Sección C).
select
  sp.id, sp.first_name, sp.last_name, sp.position, sp.email, sp.created_at
from public.staff_profiles sp
where sp.store_id is null
  and coalesce(sp.status,'active') <> 'inactive'
order by sp.last_name;


-- ============================================================
-- SECCIÓN B — RE-ENLACE (modifica datos; idempotente)
-- Ejecutar tras revisar A1/A2. Se puede correr varias veces sin daño.
-- ============================================================

-- B1. Enlazar staff_profiles.user_id con la cuenta auth que coincide por email
--     (solo cuando el email apunta a UNA sola cuenta).
update public.staff_profiles sp
set user_id = au.id
from auth.users au
where sp.user_id is null
  and sp.email is not null and sp.email <> ''
  and lower(au.email) = lower(sp.email)
  and (select count(*) from auth.users x where lower(x.email) = lower(sp.email)) = 1
  -- no pisar si esa cuenta auth ya está tomada por otro staff
  and not exists (select 1 from public.staff_profiles o where o.user_id = au.id);

-- B2. Crear user_profiles faltantes para staff ya enlazado a auth.
--     Rol según puesto: GERENTE→admin, ENTRENADOR→trainer, resto→collaborator.
insert into public.user_profiles (id, store_id, staff_profile_id, email, first_name, last_name, role, status, registration_pending)
select
  sp.user_id,
  sp.store_id,
  sp.id,
  coalesce(sp.email, au.email),
  sp.first_name,
  sp.last_name,
  case
    when upper(sp.position) = 'GERENTE' then 'admin'::public.app_role
    when upper(sp.position) = 'ENTRENADOR' then 'trainer'::public.app_role
    else 'collaborator'::public.app_role
  end,
  'active'::public.record_status,
  false
from public.staff_profiles sp
join auth.users au on au.id = sp.user_id
left join public.user_profiles up on up.id = sp.user_id
where sp.user_id is not null
  and up.id is null
  and coalesce(sp.status,'active') <> 'inactive'
  and (sp.cessation_date is null or sp.cessation_date >= current_date);

-- B3. Completar el vínculo inverso y datos faltantes en user_profiles existentes.
update public.user_profiles up
set staff_profile_id = sp.id,
    store_id = coalesce(up.store_id, sp.store_id)
from public.staff_profiles sp
where sp.user_id = up.id
  and (up.staff_profile_id is null or up.store_id is null);

-- B4. (Opcional) Reafirmar rol de gerencia/entrenador según puesto actual,
--     sin tocar superadmin. Descomenta si quieres re-sincronizar roles.
-- update public.user_profiles up
-- set role = case
--     when upper(sp.position) = 'GERENTE' then 'admin'::public.app_role
--     when upper(sp.position) = 'ENTRENADOR' then 'trainer'::public.app_role
--     else 'collaborator'::public.app_role
--   end
-- from public.staff_profiles sp
-- where sp.user_id = up.id
--   and up.role <> 'superadmin';


-- ============================================================
-- SECCIÓN C — DEPURACIÓN (BORRADO) — ⚠️ COMENTADO POR SEGURIDAD
-- Descomenta SOLO tras revisar A4. Borra personal activo sin tienda
-- y sin datos operativos asociados (sin horarios, sin ceses, sin estudios).
-- ============================================================

-- -- C0. Previsualiza EXACTAMENTE qué se borraría (corre esto primero):
-- select sp.id, sp.first_name, sp.last_name, sp.position, sp.email
-- from public.staff_profiles sp
-- where sp.store_id is null
--   and coalesce(sp.status,'active') <> 'inactive'
--   and not exists (select 1 from public.schedule_weeks w where w.staff_id = sp.id)
--   and not exists (select 1 from public.study_schedule_days d where d.staff_id = sp.id)
--   and not exists (select 1 from public.cessations c where c.staff_id = sp.id)
--   and not exists (select 1 from public.worked_holidays h where h.staff_id = sp.id)
--   and not exists (select 1 from public.extra_hours e where e.staff_id = sp.id);

-- -- C1. Borrado real (ejecuta solo si C0 muestra exactamente lo que quieres eliminar):
-- delete from public.staff_profiles sp
-- where sp.store_id is null
--   and coalesce(sp.status,'active') <> 'inactive'
--   and not exists (select 1 from public.schedule_weeks w where w.staff_id = sp.id)
--   and not exists (select 1 from public.study_schedule_days d where d.staff_id = sp.id)
--   and not exists (select 1 from public.cessations c where c.staff_id = sp.id)
--   and not exists (select 1 from public.worked_holidays h where h.staff_id = sp.id)
--   and not exists (select 1 from public.extra_hours e where e.staff_id = sp.id);
