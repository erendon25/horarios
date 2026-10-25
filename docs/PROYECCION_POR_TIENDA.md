# Posiciones de proyección por tienda

La configuración se guarda en `store_configs`, con la clave compuesta `store_id,config_key` y `config_key=schedule_projection`. Las políticas existentes permiten al administrador escribir únicamente en su tienda y al superadmin administrar las tiendas. No se requiere una migración.

Las posiciones, ajustes manuales y modo de VHL se guardan aunque todavía no exista una semana completa de ventas ni VHL histórico. Los requisitos calculados solo se reemplazan cuando sus datos están listos; el resto del documento JSON se conserva. Las solicitudes se serializan para que una respuesta lenta no reemplace una edición más reciente.

Una lista guardada se respeta completa, incluso si está vacía. Las posiciones predeterminadas se ofrecen únicamente cuando la tienda todavía no tiene una lista. Al cambiar de tienda se carga un estado independiente. Un error de lectura impide guardar valores predeterminados encima de la configuración existente y muestra Reintentar carga. Los fallos al guardar conservan la edición y ofrecen Reintentar guardado. Guardado solo aparece después de una escritura exitosa.

Actualizar datos actualiza la plantilla y las ventas sin desmontar el editor ni cancelar su guardado pendiente. Antes de salir de la pantalla se debe esperar que termine Guardando….

## Verificación

```sh
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-store-ui.mjs
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-projection-store-config-db.mjs
node --experimental-vm-modules --test src/services/positionCoverage.test.js src/lib/supabase/firestoreCompat.test.js
```

El navegador ejecuta los componentes reales Page/Dashboard con transporte HTTP aislado: editar/agregar/quitar sin ventas, actualizar inmediatamente, recargar, alternar tiendas, fallos de carga/guardado con reintentos, listas vacías y escrituras lentas. PGlite verifica la tabla y las políticas RLS reales con administradores de tiendas diferentes, superadmin, colaborador y anónimo. La evidencia queda en `output/projection-store-qa/`, excluida de Git. No se cambian configuraciones de tiendas reales durante las pruebas.

## Publicación aislada

La rama mantiene cambios de ventas pendientes de publicación. El build de la raíz no se debe desplegar para esta corrección.

`scripts/prepare-projection-store-production.mjs` reproduce la fuente aislada de la publicación anterior desde `tmp/staff-planilla-production`, verifica el bundle público `index-pB7Q5wG2.js` por SHA-256 y conserva sus assets. El modo `--overlay` agrega únicamente ScheduleProjectionDashboard y ScheduleProjectionPage. Verifica que HeatmapMatrix y WeeklyScheduleEditor permanezcan idénticos a producción. Compilar y publicar exclusivamente desde `tmp/projection-store-production` después de pasar las pruebas.
