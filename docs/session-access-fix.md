# Acceso combinado de superadmin y administrador

Publicado el 24 de octubre de 2026 en https://lc-scheduler.web.app.

La cuenta superadmin observada está activa, tiene tienda asignada y conserva su
rol `superadmin`; ese rol también permite las rutas de administrador. No se
modificaron los roles ni credenciales de cuentas existentes.

## Correcciones

- Las consultas de perfil tienen una versión de solicitud. Una respuesta antigua
  no sobrescribe un login más reciente ni restablece una sesión cerrada.
- Las consultas autenticadas se ejecutan fuera del callback de cambio de sesión.
- Un fallo temporal de perfil ofrece reintento, sin cerrar la sesión. Las rutas
  esperan a que termine la comprobación de acceso antes de redirigir.
- Los datos de cese de un perfil laboral histórico no envían a un administrador
  activo al registro de colaboradores. Los accesos administrativos inactivos
  siguen bloqueados.
- Las llamadas a `staff-account-admin` envían explícitamente el JWT de la sesión
  actual. Ante un 401 renuevan y reintentan una sola vez. Las renovaciones
  simultáneas se comparten; no se reintenta con otra cuenta ni ante 403/500.
- Los botones entre paneles dependen del rol y de la tienda asignada, en lugar
  de comparar un correo concreto.

No se cambió la configuración de validación JWT de Edge ni se ampliaron permisos
de tablas. No se identificó la respuesta interna del 401 original del usuario;
un ingreso nuevo de prueba sí funcionaba antes del cambio. Se corrigieron fallos
observables en el manejo de sesión y se probó explícitamente la recuperación.

## Verificación

- `test-authenticated-functions.mjs`: JWT actual, renovación única, concurrencia,
  cambio de cuenta, ausencia de sesión y no repetición de errores de permisos.
- `verify-session-access-ui.mjs`: escritorio/móvil, ambos paneles, cese histórico,
  fallo temporal sin logout, respuestas desordenadas y logout durante una consulta.
- `verify-legacy-staff-login-ui.mjs`: 14 flujos de login y recuperación existentes.
- `verify-staff-registration-recovery.mjs` y `verify-superadmin-accounts-ui.mjs`.
- Compilación de producción y comparación SHA-256 de la descarga pública.
- `verify-login-deployment.mjs` en la web publicada: ingreso real con contraseña de
  una cuenta temporal, botones entre ambos paneles, recarga estable y renovación
  real de Auth después de interceptar una única llamada con un 401 simulado.
  Cuenta y tienda temporales retiradas al finalizar.

La publicación se prepara con `scripts/prepare-session-access-release.mjs` y se
compila/publica desde `tmp/session-access-release`. Archivo servido:
`index-BeH5Pe5h.js`, SHA-256
`845698C2CE803583660C8C1B2AB6F171F8BB4F3F7811FF86DB5AB47B267EDFFE`.

Referencias consultadas: [eventos de autenticación](https://supabase.com/docs/reference/javascript/auth-onauthstatechange)
y [diagnóstico de 401 en Edge](https://supabase.com/kb/troubleshooting/edge-function-401-error-response).
