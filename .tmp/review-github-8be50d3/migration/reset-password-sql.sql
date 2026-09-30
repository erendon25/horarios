-- ============================================================
-- DIAGNÓSTICO + RESET DE CONTRASEÑA POR SQL (sin correos)
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Útil en plan Free donde el correo de "restablecer" no llega.
-- ============================================================

-- 1. Ver el estado de la cuenta (¿existe? ¿confirmada? ¿tiene password?)
select
  id,
  email,
  (email_confirmed_at is not null)                       as confirmada,
  (encrypted_password is not null and encrypted_password <> '') as tiene_password,
  created_at,
  last_sign_in_at
from auth.users
where lower(email) = lower('gabriela.meza0706@gmail.com');

-- 2. Poner una contraseña temporal conocida.
--    Usa pgcrypto (esquema extensions) con bcrypt, el formato que Supabase espera.
--    Cambia 'Cambiar123!' por la clave temporal que quieras entregarle.
-- update auth.users
-- set encrypted_password = extensions.crypt('Cambiar123!', extensions.gen_salt('bf')),
--     email_confirmed_at = coalesce(email_confirmed_at, now()),
--     updated_at = now()
-- where lower(email) = lower('gabriela.meza0706@gmail.com');

-- 3. Verifica que quedó con password y confirmada (repite la consulta 1).
--    Luego que inicie sesión con el correo y la clave temporal, y que la
--    cambie desde su perfil cuando pueda.

-- ------------------------------------------------------------
-- (Opcional) Reset masivo: darles a TODOS los que no tienen password
-- una misma clave temporal. Úsalo solo si es lo que quieres.
-- ------------------------------------------------------------
-- update auth.users
-- set encrypted_password = extensions.crypt('LittleCaesars2026', extensions.gen_salt('bf')),
--     email_confirmed_at = coalesce(email_confirmed_at, now()),
--     updated_at = now()
-- where encrypted_password is null or encrypted_password = '';
