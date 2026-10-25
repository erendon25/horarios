# Accesos a estudios y solicitudes por tienda

En AdminDashboard, «Accesos a horarios» permite configurar:

- **Solo administración edita los horarios de estudio**: al activarlo desaparece la edición de estudios del panel del colaborador. Administración conserva la edición y los estudios registrados no se borran. Desactivarlo vuelve a habilitar la opción.
- **Habilitar solicitudes de horario**: controla la creación de nuevas solicitudes de esa tienda.
- **Semana de solicitudes**: selecciona cualquier fecha de la semana; se utiliza su lunes para habilitar o bloquear todos sus días.
- **Fecha a bloquear**: permite impedir solicitudes para un día concreto, sin cerrar el resto de la semana.

Los cambios se aplican al pulsar **Guardar permisos de horario**. Las semanas y fechas corresponden al día del turno solicitado. Las condiciones existentes de carnet y bloqueo temporal siguen aplicándose por separado. La opción de gestión de estudios no bloquea las solicitudes.

El colaborador encuentra sus solicitudes en **Mis solicitudes de horario**. Puede eliminar únicamente las propias que siguen pendientes y sin revisar. Las aprobadas y rechazadas se conservan como historial. Ver el listado y eliminar una pendiente no requieren que esté abierta la recepción de nuevas solicitudes. Si administración la revisó mientras intentaba eliminarla, la eliminación se rechaza y se ofrece actualizar el listado.

## Persistencia y validación

La configuración se guarda en `store_configs`, clave `schedule_access`, dentro de la tienda correspondiente:

```json
{
  "adminOnlyStudyEditing": false,
  "requestsEnabled": true,
  "blockedWeeks": ["2026-11-02"],
  "blockedDates": ["2026-10-30"]
}
```

Solo la ausencia verificada del documento usa los valores predeterminados. Una configuración presente incompleta o inválida, o un error al consultarla, bloquea nuevas ediciones y solicitudes hasta verificarla. No elimina datos existentes.

`update_schedule_access` valida el administrador y su tienda, bloquea la fila y aplica los cambios respecto del borrador original. Dos administradores pueden añadir fechas distintas sin perder los bloqueos del otro. También se conservan los metadatos y campos adicionales. Un guardado sin cambios no modifica el registro.

El formulario vuelve a comprobar configuración y disponibilidad antes de crear una solicitud. El calendario deshabilita las fechas no permitidas; introducirlas manualmente tampoco permite aceptarlas. Un bloqueo nuevo elimina la selección que dejó de estar habilitada, sin crear solicitudes.

La migración `20261025055140_store_schedule_access_controls.sql` añade validación en la base de datos, sin modificar el RPC original de estudios: bloquea sus mutaciones para colaboradores cuando corresponde, restringe nuevas solicitudes por fecha/semana y permite el borrado de pendientes propias mediante RLS. Revisar solicitudes existentes sigue permitido aunque posteriormente se cierre su fecha. Los helpers y el RPC nuevos usan `SECURITY INVOKER`, con autorización explícita y sin ejecución anónima.

El trigger de nuevas solicitudes también comprueba el bloqueo temporal anterior (`schedule_lock`) con lectura sujeta a RLS y fecha de Lima. Su cumplimiento no depende de que la política de identidad de solicitudes conserve un predicado antiguo. Ese bloqueo no impide revisar solicitudes ya enviadas ni eliminar pendientes propias.

El guard de estudios verifica explícitamente que un administrador edite únicamente personal de su tienda, además de los controles del RPC y RLS existentes. Conserva las cascadas autorizadas de eliminación sin modificar el cuerpo original del escritor de estudios.

## Pruebas y vista previa

```sh
node --test src/services/scheduleAccessPolicy.test.js
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs node scripts/test-schedule-access-policy-hook.mjs
PGLITE_MODULE=/ruta/a/@electric-sql/pglite/dist/index.js node scripts/test-schedule-access-db.mjs
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs node scripts/verify-schedule-access-ui.mjs
```

Las pruebas usan perfiles y tiendas ficticias, PostgreSQL aislado y los componentes React reales. La vista previa utiliza almacenamiento local y bloquea las conexiones de backend. No configura tiendas reales.

La migración debe aplicarse antes de publicar la interfaz operativa. No desplegar el build de la raíz: contiene cambios de ventas ajenos al conjunto aprobado. `scripts/prepare-reviewed-scheduling-production.mjs` prepara una publicación aislada con las fuentes revisadas de proyección y accesos, conservando los recursos de la versión anterior.
