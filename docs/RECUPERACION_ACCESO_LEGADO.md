La pantalla de acceso intenta primero Supabase. Si recibe `invalid_credentials`, consulta `recover-legacy-staff-login`. Esa función valida la contraseña contra Firebase únicamente para una ficha incluida previamente por el administrador en `private.approved_legacy_staff_logins`. Se comprobaron las dos identidades de Firebase con una consulta que excluye contraseñas, hashes y tokens; el administrador confirmó sus correos habituales.

Cada autorización caduca a los 14 días y fija correo, UID de Firebase, ficha, tienda, correo anterior y cuenta anterior esperada. No se recuperan administradores, perfiles inactivos, tiendas inactivas, ceses efectivos ni entrenamientos finalizados. Hay un límite de cinco intentos por autorización cada 15 minutos. Las RPC de preparación y vinculación solo son ejecutables por `service_role`; la función pública exige autenticación propia con la contraseña de Firebase y el UID exacto autorizado. Nunca escribe una contraseña de una cuenta Supabase existente ni acepta identificadores de ficha enviados por el navegador.

Después de validar la contraseña se crea una cuenta Supabase con esa misma contraseña y metadata de servidor que identifica la autorización. La vinculación es atómica e idempotente, conserva la ficha y sus horarios y marca el registro como activo. Si había una cuenta vinculada incorrectamente, se conserva su cuenta Auth y se revoca únicamente su acceso a esa ficha; la autorización guarda el vínculo anterior para auditoría. Una creación interrumpida se puede reintentar sin borrar la cuenta que pudo haberse creado. Las autorizaciones completadas dejan de poder usar Firebase: los accesos posteriores funcionan directamente con Supabase.

La migración solo instala el esquema y las funciones; las autorizaciones se añaden por separado tras revisar los datos actuales. Esta recuperación no envía correos, no almacena contraseñas ni tokens de Firebase y no reabre el importador antiguo.

Validación local:

```bash
node scripts/test-legacy-staff-login.mjs
PGLITE_MODULE=/ruta/a/@electric-sql/pglite/dist/index.js node scripts/test-legacy-staff-login-db.mjs
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-legacy-staff-login-ui.mjs
npm run build
```

Las pruebas de función cubren contraseña/UID/correo inválidos, cuentas no autorizadas, fallo de red, límite de intentos y creación concurrente. Las pruebas SQL ejecutan las RPC reales, comprueban permisos, caducidad, vigencia, cambio inesperado de propietario, conservación de DNI y turnos, revocación del vínculo equivocado e idempotencia. La prueba de navegador usa el `AuthProvider` y `Login` reales con transporte simulado en escritorio y móvil. No se usa la contraseña real de ninguna colaboradora: la recuperación definitiva ocurre cuando cada una inicia sesión con su contraseña habitual.

En producción se verificaron las dos autorizaciones, los permisos de las cuatro funciones y el rechazo de un correo no autorizado. El asesor informa [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) en la tabla privada: es intencional, porque no se admite acceso de `anon` ni `authenticated`; solo `service_role` y las funciones privadas autorizadas pueden leerla. La advertencia anterior sobre [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) continúa sin cambios.

Para desactivar una autorización pendiente, establecer `enabled = false` en su fila privada. Para retirar la recuperación por completo, desactivar la función de Edge; el acceso normal por Supabase sigue disponible.
