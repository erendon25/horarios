# Posiciones de proyección por tienda

La configuración se guarda en `store_configs`, con la clave compuesta `store_id,config_key` y `config_key=schedule_projection`. Las políticas existentes permiten al administrador escribir únicamente en su tienda y al superadmin administrar las tiendas. No se requiere una migración.

Las posiciones, ajustes manuales y modo de VHL se guardan aunque todavía no exista una semana completa de ventas ni VHL histórico. Los requisitos calculados solo se reemplazan cuando sus datos están listos; el resto del documento JSON se conserva. Las solicitudes se serializan para que una respuesta lenta no reemplace una edición más reciente.

Una lista guardada se respeta completa, incluso si está vacía. Las posiciones predeterminadas se ofrecen únicamente cuando la tienda todavía no tiene una lista. Al cambiar de tienda se carga un estado independiente. Un error de lectura impide guardar valores predeterminados encima de la configuración existente y muestra Reintentar carga. Los fallos al guardar conservan la edición y ofrecen Reintentar guardado. Guardado solo aparece después de una escritura exitosa.

Actualizar datos actualiza la plantilla y las ventas sin desmontar el editor ni cancelar su guardado pendiente. Antes de salir de la pantalla se debe esperar que termine Guardando….

Configurar Posiciones usa tarjetas con campos etiquetados que se ajustan al ancho disponible. El encabezado y el pie permanecen visibles; solo se desplaza verticalmente el contenido. Nueva posición abre el formulario y enfoca su nombre sin desplazar el panel. Mientras está abierto, Agregar permanece en el pie junto a Cerrar. Remover permanece dentro de cada tarjeta, sin una columna oculta a la derecha. Se bloquea el desplazamiento del fondo mientras el panel está abierto y se restaura al cerrar.

En Distribución de Personal e Ingresos por Hora, cada posición tiene una escala de color según su propio Tope de personal. Cero personas es neutro y una persona es azul; desde dos personas avanza de amarillo a naranja y llega a rojo al alcanzar o superar el límite. Un límite de una persona se muestra rojo desde una; con límite cero, cualquier asignación positiva es roja. Las posiciones fijas usan Personal fijo. Si no hay límite configurado, desde dos personas se muestra amarillo, sin inventar un umbral rojo de tres. El tooltip indica cantidad y límite. Cambiar el tope actualiza el color inmediatamente sin cambiar la cantidad asignada.

Cada posición incluye Grupo del área: Producción o Servicio. La clasificación se elige explícitamente, por separado de la lógica de cálculo. La tabla muestra por hora ambos subtotales y mantiene el total general. Las áreas antiguas sin grupo muestran un aviso y el subtotal Sin clasificar; siguen contando en el total. Este subtotal desaparece al clasificar todas las áreas. Las nuevas posiciones requieren nombre y grupo. Reclasificar mueve las cantidades entre subtotales sin alterar dotación, límites, ajustes manuales ni colores. El grupo se guarda dentro de la configuración propia de cada tienda.

## VHL de Vestido y factores de otras áreas

Vestido usa venta de la hora ÷ VHL general; S/2,000 con VHL S/500 produce cuatro personas. Primero se aplica su redondeo a personas completas, mínimo, tope o ajuste manual. Las áreas con lógica Personas de Vestido × factor multiplican esa cantidad final por su propio factor, y después aplican su redondeo, mínimo y tope. Con cuatro personas en Vestido y factor0.5 resultan dos; si la proporción bruta da ocho pero el tope de Vestido lo limita a cinco, factor0.7 usa cinco y produce cuatro. Un ajuste manual de Vestido también se propaga a las áreas dependientes, incluso en una hora sin venta. Los ajustes manuales propios de otras áreas siguen teniendo prioridad.

Servicio/punto de venta, Driver y Fijo conservan sus parámetros y fórmulas independientes. Los límites son los configurados por el administrador; una posición personalizada llamada Masa no recibe un tope oculto si su máximo está vacío. Los factores vacíos mantienen las referencias anteriores de Sheetout/Masa/Landing, y los factores inválidos no generan demanda.

El máximo cero explícito en Vestido y áreas por factor conserva la regla anterior: deja demanda automática cero antes de aplicar el mínimo; un ajuste manual sigue teniendo prioridad. Máximos vacíos no se convierten en cero. Servicio, Driver y Fijo conservan su tratamiento anterior del máximo cero.

## Horas hombre proyectadas en el mapa de cobertura

El encabezado del Heatmap muestra HH proyección del día seleccionado y el total de los siete días guardados. El Total HH programadas del editor conserva su cálculo anterior, con las horas extra aparte. El nuevo resumen usa la matriz original de requisitos de la tienda: cada celda representa personas durante una hora. Tres personas en cuatro celdas horarias suman12HH. No se cuentan los carriles, los colores, las cuatro subdivisiones visuales ni la marca inclusiva de salida.

Si no hay matriz guardada, se muestra Sin proyección; una matriz explícita con cero o vacía representa0HH. Si faltan días, el total muestra Parcial y cuántos días están disponibles. Carga y error no se muestran como cero. Se conserva la suma completa de columnas de la proyección, aunque alguna quede fuera del rango visible del mapa. Filtros de personal no alteran el requerimiento proyectado.

La referencia es la última configuración guardada por día de la semana. El modelo actual no almacena una semana calendario objetivo, por lo que el resumen no atribuye esos requisitos a la semana del histórico de ventas ni a una fecha objetivo inventada. La suscripción se mantiene limitada a la tienda y descarta callbacks de una tienda anterior.

El resumen también aparece en pantalla completa y se actualiza con la configuración en vivo. El mapa conserva su pintado, transferencias, exportaciones y celdas. En pantallas bajas el contenedor mantiene una altura mínima para conservar una región visible de la matriz.

En Configurar Posiciones, el selector Área Vestido guarda el identificador estable `vestidoPositionId`, independiente del nombre del área. En datos anteriores se descubre una sola vez el identificador histórico cocina o un nombre exacto Vestido normalizado; los casos ambiguos requieren selección explícita. Renombrar conserva la referencia. Al quitar la referencia o borrar esa área queda pendiente elegir otra, sin reasignación silenciosa. La posición elegida usa venta/VHL aunque su lógica o factor anterior fueran diferentes; los controles muestran la fórmula efectiva y conservan los parámetros anteriores para recuperarlos al cambiar de referencia.

## Verificación

```sh
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-store-ui.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-modal-responsive.mjs
node --test src/services/projectionStaffColor.test.js
node --test src/services/projectionStaffGroups.test.js
node --test src/services/projectionDemand.test.js
node --test src/services/projectionHours.test.js
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-staff-colors.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-staff-groups.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-demand.mjs
PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-projection-hours.mjs
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

Para la demanda basada en Vestido, `scripts/prepare-projection-demand-production.mjs` parte de `tmp/projection-groups-production` y verifica `index-W7znYIRA.js`. Usar `--overlay` y publicar desde `tmp/projection-demand-production`. Solo se superponen Dashboard, ProjectionPositionFields, projectionVhl y projectionDemand; se conservan los assets y las demás fuentes del release anterior.

Para HH en el Heatmap, `scripts/prepare-heatmap-projection-hours-production.mjs` parte de `tmp/projection-demand-production`, verifica `index-CFz8nLOS.js` y conserva sus assets. Usar `--overlay` y publicar desde `tmp/heatmap-projection-hours-production`. Solo se superponen WeeklyScheduleEditor, ScheduleHeatmapMatrix, ProjectionHoursSummary y projectionHours. Una comprobación estructural exige que el código del mapa sea idéntico al anterior al retirar el import, prop y nodo nuevos del resumen.
