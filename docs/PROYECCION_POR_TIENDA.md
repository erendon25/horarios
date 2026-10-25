# Posiciones de proyección por tienda

La configuración se guarda en `store_configs`, con la clave compuesta `store_id,config_key` y `config_key=schedule_projection`. Las políticas existentes permiten al administrador escribir únicamente en su tienda y al superadmin administrar las tiendas. No se requiere una migración.

Las posiciones, ajustes manuales y modo de VHL se guardan aunque todavía no exista una semana completa de ventas ni VHL histórico. Los requisitos calculados solo se reemplazan cuando sus datos están listos; el resto del documento JSON se conserva. Las solicitudes se serializan para que una respuesta lenta no reemplace una edición más reciente.

Una lista guardada se respeta completa, incluso si está vacía. Las posiciones predeterminadas se ofrecen únicamente cuando la tienda todavía no tiene una lista. Al cambiar de tienda se carga un estado independiente. Un error de lectura impide guardar valores predeterminados encima de la configuración existente y muestra Reintentar carga. Los fallos al guardar conservan la edición y ofrecen Reintentar guardado. Guardado solo aparece después de una escritura exitosa.

Actualizar datos actualiza la plantilla y las ventas sin desmontar el editor ni cancelar su guardado pendiente. Antes de salir de la pantalla se debe esperar que termine Guardando….

Configurar Posiciones usa tarjetas con campos etiquetados que se ajustan al ancho disponible. El encabezado y el pie permanecen visibles; solo se desplaza verticalmente el contenido. Nueva posición abre el formulario y enfoca su nombre sin desplazar el panel. Mientras está abierto, Agregar permanece en el pie junto a Cerrar. Remover permanece dentro de cada tarjeta, sin una columna oculta a la derecha. Se bloquea el desplazamiento del fondo mientras el panel está abierto y se restaura al cerrar.

En Distribución de Personal e Ingresos por Hora, cada posición tiene una escala de color según su propio Tope de personal. Cero personas es neutro y una persona es azul; desde dos personas avanza de amarillo a naranja y llega a rojo al alcanzar o superar el límite. Un límite de una persona se muestra rojo desde una; con límite cero, cualquier asignación positiva es roja. Las posiciones fijas usan Personal fijo. Si no hay límite configurado, desde dos personas se muestra amarillo, sin inventar un umbral rojo de tres. El tooltip indica cantidad y límite. Cambiar el tope actualiza el color inmediatamente sin cambiar la cantidad asignada.

Cada posición incluye Grupo del área: Producción o Servicio. La clasificación se elige explícitamente, por separado de la lógica de cálculo. La tabla muestra por hora ambos subtotales y mantiene el total general. Las áreas antiguas sin grupo muestran un aviso y el subtotal Sin clasificar; siguen contando en el total. Este subtotal desaparece al clasificar todas las áreas. Las nuevas posiciones requieren nombre y grupo. Reclasificar mueve las cantidades entre subtotales sin alterar dotación, límites, ajustes manuales ni colores. El grupo se guarda dentro de la configuración propia de cada tienda.

## Verificación

```sh
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-store-ui.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-modal-responsive.mjs
node --test src/services/projectionStaffColor.test.js
node --test src/services/projectionStaffGroups.test.js
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-staff-colors.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-staff-groups.mjs
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-projection-store-config-db.mjs
node --experimental-vm-modules --test src/services/positionCoverage.test.js src/lib/supabase/firestoreCompat.test.js
```

El navegador ejecuta los componentes reales Page/Dashboard con transporte HTTP aislado: editar/agregar/quitar sin ventas, actualizar inmediatamente, recargar, alternar tiendas, fallos de carga/guardado con reintentos, listas vacías y escrituras lentas. PGlite verifica la tabla y las políticas RLS reales con administradores de tiendas diferentes, superadmin, colaborador y anónimo. La evidencia queda en `output/projection-store-qa/`, excluida de Git. No se cambian configuraciones de tiendas reales durante las pruebas.

La prueba responsive comprueba el panel y sus campos a 390×844, 768×600, 991×435, 1024×768 y 1440×900: sin desborde horizontal, acciones del pie visibles, altas/bajas persistentes y foco en el nuevo nombre. También conserva la aceptación previa de tickets y factores decimales. Capturas y medidas: `output/projection-modal-responsive/`.

## Publicación aislada

La rama mantiene cambios de ventas pendientes de publicación. El build de la raíz no se debe desplegar para esta corrección.

`scripts/prepare-projection-store-production.mjs` reproduce la fuente aislada de la publicación anterior desde `tmp/staff-planilla-production`, verifica el bundle público `index-pB7Q5wG2.js` por SHA-256 y conserva sus assets. El modo `--overlay` agrega únicamente ScheduleProjectionDashboard y ScheduleProjectionPage. Verifica que HeatmapMatrix y WeeklyScheduleEditor permanezcan idénticos a producción. Compilar y publicar exclusivamente desde `tmp/projection-store-production` después de pasar las pruebas.

Para la corrección responsive posterior, `scripts/prepare-projection-modal-production.mjs` parte de `tmp/staff-permissions-production` y verifica el bundle publicado `index-Dm9qh2vS.js`. Usar `--overlay --with-position-fields` para añadir únicamente ScheduleProjectionDashboard y ProjectionPositionFields. Compilar y publicar desde `tmp/projection-modal-production`; conservar el resto de fuentes y los assets verificados de la publicación anterior.

Para los colores por límite, `scripts/prepare-projection-colors-production.mjs` parte de `tmp/projection-modal-production`, verifica `index-CJagACKa.js` y conserva sus assets. Usar `--overlay --with-color-service` y publicar únicamente `tmp/projection-colors-production`, con los cambios de Dashboard y projectionStaffColor. No se modifican HeatmapMatrix, horarios, permisos ni datos de tiendas.

Para el desglose por grupo, `scripts/prepare-projection-groups-production.mjs` parte de `tmp/projection-colors-production`, verifica `index-Dwb8sZbS.js` y conserva sus assets. Usar `--overlay --with-groups-service` y publicar desde `tmp/projection-groups-production`, únicamente con los cambios de Dashboard, ProjectionPositionFields y projectionStaffGroups. No requiere una migración de base de datos ni asigna grupos automáticamente a tiendas reales.
