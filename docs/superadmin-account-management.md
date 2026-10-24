# Gestión de cuentas desde superadmin

El panel tenía creación de administradores pero no un directorio. Además, enviaba
`delete_staff` y `unlink_staff` a una Edge Function que solo reconocía creación,
invitación y recuperación, por lo que devolvía `400 invalid_payload`.

## Cambios

- Directorio de administradores de todas las tiendas, incluidos inactivos, con
  búsqueda y actualización después de crear una cuenta.
- Edición de correo y contraseña. Una contraseña vacía conserva la existente.
  Solo un superadmin activo puede listar y editar; el destino debe tener rol admin.
- El correo de Auth y los perfiles se sincronizan mediante un trigger transaccional.
  Las contraseñas se envían exclusivamente a Auth, nunca a tablas de perfiles.
- Eliminación y desvinculación autorizadas de nuevo dentro de PostgreSQL.
  No se permite borrar cuentas administrativas desde el directorio de colaboradores.
- La eliminación borra la cuenta, sesiones y datos del colaborador; conserva los
  registros de otros colaboradores y los nombres históricos de sus evaluadores.
- Los archivos propiedad de la cuenta se retiran mediante Storage antes de borrar
  los datos. Storage y PostgreSQL no comparten una transacción: si falla el paso
  final, el panel avisa que los archivos ya se retiraron y permite reintentar.
  La transacción revalida la identidad vinculada antes de eliminar.
- Si la cuenta es propietaria de firmas usadas por evaluaciones que deben
  conservarse, la operación se detiene antes de retirar archivos y explica que
  se necesita reasignar su propiedad. No se destruyen firmas de otros colaboradores.
- Los fallos de PostgreSQL revierten todos los cambios de base de datos.

## Orden de publicación

Proyecto: `nwwnnnjppycdrbeuzhnf`. Sitio: `lc-scheduler.web.app`.

1. Aplicar y registrar la migración
   `supabase/migrations/20261024180657_superadmin_account_management.sql` y luego
   `supabase/migrations/20261024190312_superadmin_delete_active_staff.sql`.
   La migración agrega capacidades y sincroniza correos existentes; no elimina
   colaboradores ni cambia contraseñas reales.
2. Publicar `supabase/functions/staff-account-admin/index.ts` conservando la
   configuración de autenticación de la función y sus secretos existentes.
3. Preparar la publicación mediante `node scripts/prepare-superadmin-release.mjs`,
   ejecutar `npm run build` en `tmp/superadmin-release` y publicar el target Firebase
   Hosting `lc-scheduler` desde ese directorio. Conserva la corrección de canales
   de ventas ya publicada y agrega únicamente los cambios de cuentas y los avisos.
4. Con una sesión real de superadmin, comprobar que se listan los administradores.
   Validar cambios de correo/contraseña y eliminación únicamente con una cuenta
   de prueba creada expresamente para esa comprobación.

No publicar solo el frontend ni la función antes de la migración: dependen de
las nuevas operaciones y de la sincronización transaccional del correo.

## Validación local

- `node scripts/test-create-store-admin.mjs`
- `node scripts/test-staff-access-recovery.mjs`
- `node scripts/test-superadmin-accounts.mjs`
- `node scripts/test-superadmin-accounts-db.mjs` (requiere `PGLITE_MODULE` si
  PGlite está instalado en el runtime temporal).
- `node scripts/test-staff-history-archives.mjs` (mismo runtime PGlite).
- `node scripts/verify-superadmin-accounts-ui.mjs` (Playwright; puede usarse
  `CHROMIUM_PATH` para indicar un Chromium local).
- `npm run build`

La prueba SQL usa PostgreSQL local con las migraciones de concursos y archivo
histórico. Comprueba permisos, reversión ante fallos, evaluaciones firmadas,
sesiones, identidad vinculada, archivos y conservación de datos de terceros.
La prueba de navegador usa los componentes reales con transporte local ficticio,
en escritorio y móvil. No cambia cuentas reales.

## Conexión del equipo de despliegue

Las herramientas requieren usar los certificados de confianza de Windows:

```powershell
$env:NODE_USE_SYSTEM_CA = '1'
```

Este ajuste conserva la verificación TLS y resuelve el error
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` de Supabase CLI y Firebase CLI. Con él se
confirmó acceso al sitio Firebase `lc-scheduler`.

El 24 de octubre de 2026 se conectó la cuenta autorizada mediante Supabase CLI.
La CLI usa la sesión nueva; el archivo antiguo `~/.supabase/access-token` puede
seguir conteniendo credenciales de otra cuenta y no debe usarse para publicar.

## Hallazgos de la comprobación en producción

La restricción `user_profiles_active_staff_link_check` impide que un perfil activo
de colaborador o entrenador quede sin vínculo. La migración de seguimiento marca
el perfil como inactivo dentro de la misma transacción antes de borrar al
colaborador y su cuenta. Un fallo revierte también ese cambio de estado. La prueba
SQL ahora incluye la restricción real y comprueba esa reversión.

`ToastContainer` estaba declarado fuera del árbol renderizado. Se incorporó al
componente `App` para mostrar los avisos de éxito y error del panel.

La prueba `scripts/verify-superadmin-deployment.mjs` requiere habilitación explícita
mediante `VERIFY_SUPERADMIN_PROJECT`, una sesión CLI autorizada y Playwright. Crea
cuentas y una tienda desechables, comprueba la web real y limpia exclusivamente los
registros generados. No imprime ni guarda claves, contraseñas ni sesiones.

## Resultado publicado — 24 de octubre de 2026

- Ambas migraciones quedaron aplicadas y registradas con sus versiones locales.
- `staff-account-admin` está activa en versión 15, manteniendo `verify_jwt: true`.
- Firebase Hosting publicó `index-BHW2FE_0.js`. La descarga desde la web coincidió
  con la compilación local: SHA-256
  `0CCA60C7F75996F4B07B736B9D20846CC7C4B514F33188B6351F1EFBAAF106B2`.
- La prueba real pasó: creación, listado de activos e inactivos, permisos,
  edición desde la web en escritorio/móvil, sincronización del correo, inicio de
  sesión con nueva contraseña y rechazo de la anterior, conservación de contraseña
  vacía, eliminación de colaborador/cuenta/foto, rechazo del acceso eliminado y
  desvinculación con conservación del perfil. Se retiraron todos los datos de prueba.
- Pasaron las pruebas locales de Edge, transacciones PostgreSQL con la restricción
  real y agregación de ventas de la publicación final.
- El asesor de seguridad previo solo informó la protección de contraseñas filtradas
  deshabilitada; no se cambió esa configuración durante este trabajo.

## Ampliación: eliminación de administradores

El mismo 24 de octubre se publicó la migración
`20261024191003_superadmin_delete_administrators.sql`, la operación `delete_admin`
en Edge y el botón **Eliminar administrador** en el directorio de superadmin.
La confirmación identifica el correo y explica el alcance irreversible.

La base de datos revalida que el solicitante sea superadmin activo y el destino
sea administrador. Rechaza cuentas de superadmin, el propio solicitante y otros
roles. El borrado elimina Auth, sesiones y perfil administrativo, conserva la
tienda y el historial y desvincula cualquier perfil laboral existente. Los archivos
personales se retiran mediante Storage; las firmas compartidas con evaluaciones
conservadas bloquean la operación antes de retirar archivos. Los errores del paso
SQL revierten toda la transacción.

El error `permission denied for table staff_profiles` provenía de llamadas directas
del panel de tienda. Esos recorridos ahora llaman a la operación segura de Edge;
la eliminación y la desvinculación están reservadas a superadmin, conforme a la
autorización del servidor. No se otorgaron permisos DELETE sobre las tablas.

Publicación reproducible mediante `scripts/prepare-admin-delete-release.mjs`,
con compilación y despliegue desde `tmp/admin-delete-release`. Archivo servido:
`index-VBFEW1Bo.js`, SHA-256
`C22CC1F0810765801394ED16D1349B97AE0AE2CCE4528F6C4AA8DD7D7344A009`.

Validaciones adicionales aprobadas:

- SQL: autorización, protección de superadmin, reversión ante fallo, sesiones y
  conservación del perfil laboral, tienda y evaluaciones firmadas.
- Edge: validación de identificadores, límites de intentos, permisos y retiro de
  archivos antes de completar el borrado.
- Navegador local, escritorio/móvil: cancelación, error y eliminación desde el panel.
- Prueba real en la web: eliminación de un administrador desechable, cancelación,
  rechazo a usuarios sin permiso y al borrado de superadmin, revocación del acceso,
  conservación de tienda y reutilización del correo eliminado. Limpieza completa
  de los registros generados.
- `scripts/test-admin-dashboard-account-actions.mjs`: las acciones del panel de
  tienda usan Edge, respetan permisos y confirmación y conservan la vista si falla
  el servidor.
- Asesor de seguridad sin nuevos avisos respecto de la publicación anterior.
