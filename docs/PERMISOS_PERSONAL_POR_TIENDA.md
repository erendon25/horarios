# Edición y eliminación de colaboradores

El directorio de personal del superadmin incluye **Editar información**. Reutiliza el formulario del administrador y conserva la tienda del perfil, aunque el superadmin tenga otra tienda asignada. Guardar actualiza el listado y mantiene los filtros; un fallo de lectura posterior al guardado ofrece Actualizar colaboradores.

Los administradores activos pueden eliminar colaboradores únicamente de su propia tienda activa. La autorización se comprueba en el botón, en `staff-account-admin` y dentro de la transacción SQL. El identificador de tienda enviado desde el navegador no decide el permiso. Los identificadores antiguos de Firebase se resuelven dentro de la tienda autorizada.

Las cuentas administrativas, las cuentas de superadmin y la cuenta propia están protegidas. Administrar otras cuentas y desvincular correos sigue reservado al superadmin. El DELETE directo a `staff_profiles` está revocado; la eliminación debe pasar por el servicio autorizado.

Antes de borrar el perfil y su acceso, la transacción conserva horarios y demás historial como registros de texto en `staff_history_archives`, sin vínculo a un usuario o perfil activo. Sus permisos de lectura siguen limitados al administrador de la tienda y al superadmin. No se conservan perfiles sintéticos. Un fallo revierte el archivo y los borrados SQL juntos; la limpieza de archivos continúa usando el flujo existente de Storage con inspección autorizada previa.

## Verificación

```sh
node scripts/test-admin-dashboard-account-actions.mjs
node scripts/test-superadmin-accounts.mjs
node --test src/services/staffProfileSave.test.js
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-store-admin-staff-deletion-db.mjs
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-superadmin-accounts-db.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/test-superadmin-staff-edit-ui.mjs
```

Se verificaron 320 combinaciones del handler de administración, diez grupos SQL de permisos/históricos/cascadas, las operaciones Edge y tres recorridos de edición del superadmin con el formulario real. Los datos de prueba son ficticios y están aislados; no se elimina ni modifica personal real al verificar o publicar esta funcionalidad.

## Publicación

El nombre histórico de la RPC `superadmin_manage_staff_account` se conserva por compatibilidad. La nueva implementación delega solo `inspect_delete_staff` y `delete_staff` al administrador de la misma tienda. El helper privado de archivo es SECURITY INVOKER y no es ejecutable por los clientes.

La migración se registró remotamente como `20261025011205_store_admin_delete_staff.sql`; el nombre local se alineó a esa versión manteniendo el SQL probado. La función Edge publicada es la versión 18 y conserva la verificación JWT.

La rama mantiene cambios de ventas pendientes. `scripts/prepare-staff-permissions-production.mjs` verifica el build publicado de proyección y prepara `tmp/staff-permissions-production`. Solo superpone AdminDashboard, SuperAdminDashboard y staffAccountAdmin; proyección, Heatmap y WeeklyScheduleEditor deben conservar sus hashes. El build de la raíz no se publica para este cambio.
