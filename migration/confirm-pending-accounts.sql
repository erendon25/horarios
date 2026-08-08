-- ============================================================
-- CONFIRMAR CUENTAS PENDIENTES (para que puedan iniciar sesión)
-- Úsalo cuando "Confirm email" estaba activo y el correo no llegó.
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Ver cuentas registradas SIN confirmar (no pueden entrar todavía):
select id, email, created_at, email_confirmed_at
from auth.users
where email_confirmed_at is null
order by created_at desc;

-- 2a. Confirmar UNA cuenta específica (recomendado, revisa el correo):
-- update auth.users
-- set email_confirmed_at = coalesce(email_confirmed_at, now())
-- where email = 'gabriela.meza0706@gmail.com';

-- 2b. Confirmar TODAS las cuentas pendientes de golpe (úsalo con criterio):
-- update auth.users
-- set email_confirmed_at = coalesce(email_confirmed_at, now())
-- where email_confirmed_at is null;

-- 3. Verificar que quedaron confirmadas (email_confirmed_at con fecha):
-- select email, email_confirmed_at from auth.users
-- where email in ('gabriela.meza0706@gmail.com');
