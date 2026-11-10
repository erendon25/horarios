# Auditoría de la vista de cobertura publicada

## Resultado y corrección del diagnóstico

La recuperación del PR #4 fue incompleta: utilizó el código de las ramas de Git
consultadas, sin contrastarlo con todas las publicaciones posteriores de Firebase.
No basta con recuperar esa rama para recuperar el último comportamiento publicado.

La última versión anterior a la regresión de las exportaciones del 9 de noviembre
es `05fc44d79cbcfeff`, publicada el **2 de noviembre de 2026 a las 19:48:00 de Lima**
(`2026-11-03T00:48:00.749Z`). Contiene 290 archivos, incluidos assets históricos
retenidos. Su entrada activa es `/assets/index-Fm_Fl8QJ.js`.

Hubo 21 publicaciones posteriores al release inicial de cobertura del 25 de octubre
(`fb05bb8cced1c112`) y hasta esa versión. El historial local y las ramas remotas
consultadas no contienen las funcionalidades posteriores enumeradas aquí.

Producción durante esta auditoría sigue en `eb7c3680e5b752df` (código `07a901d`,
integrado mediante el PR #4). La proyección por cuartos del PR #5 sigue pendiente
de integración y publicación. No se modificaron horarios, perfiles ni reglas del
backend durante la auditoría.

## Funciones publicadas que faltan o retrocedieron

| Función | Versión publicada antes de la regresión | Versión recuperada actualmente |
| --- | --- | --- |
| Arrastrar una tarjeta al mapa | Tarjetas arrastrables con sesión y token, destino por posición/hora, propuesta y aplicación al borrador | No hay arrastre de tarjetas ni callbacks de colocación |
| Día libre rápido | Checkbox en cada tarjeta; confirma cuando retirará horas, posición y break | Solo se puede editar dentro del editor de turno o en la vista clásica |
| Feriado compensado rápido | Checkbox junto al día libre; aplica la misma lógica BUK que la vista clásica | No aparece en la tarjeta |
| Alternativa al arrastre | Botón «Elegir destino sin arrastrar», usable con teclado y pantalla táctil | No existe |
| Mover un turno existente | Modo «Mover», vista previa, cancelación y comprobación de semanas contiguas | Solo queda el traslado de un tramo desde excedentes; no equivale al flujo publicado |
| Deshacer y rehacer | Acciones en la barra y el pie del panel; historial agrupado de cambios | No existen los controles ni los métodos correspondientes en el controlador actual |
| Guardar desde el panel | Pie del panel con Guardar, estado y error de guardado | Solo está Guardar en la barra superior |
| Vista previa semanal | Acción «Ver horario semanal», con borrador y agrupación por categoría | No está la acción ni su diálogo |
| Vista semanal de breaks | Vista alternativa dentro de la vista previa semanal | No existe |
| Ficha rápida del colaborador | Hover/foco y botón de información con estudios, datos y contexto semanal | El panel no recibe esos callbacks; el tooltip clásico no sustituye este acceso |
| Filtros propios del listado | Modalidad, categoría de trabajo y filtros plegables con resumen | Solo búsqueda y Todos/Sin turno/Con alertas |
| Ventas/TRX, VHL y THL visibles | Bloque `heatmap-extra-metrics`, siempre visible en la cabecera | Ocultos en «Más métricas» |
| Horas faltantes y excedentes | Totales y desglose Producción/Servicio/Sin clasificar, con alcance filtrado y estados de carga/error | No existe ese bloque de métricas |
| Personas por hora | Indicador mínimo–máximo de cuatro cortes, popup con personas distintas por cada cuarto y desglose | No existen esos indicadores ni el popup |
| Información en celdas del mapa | Identidad del ocupante, información al pasar/fijar foco, selección del colaborador y marca de salida | Las celdas actuales solo informan el estado de cobertura y no contienen ese contexto |
| Rango nocturno | 07:00–26:00 (02:00 del día siguiente); el límite final no aporta duración | 07:00–25:00 (01:00); falta la última hora del rango publicado |
| Agregar un candidato desde cobertura | Selección de turno aprobado y «Agregar turno», con nueva comprobación antes de escribir al borrador | La consulta solo permite «Ver en editor» |
| Explicación de candidatos excluidos | Categoría requerida, personas sin categorizar, causas individuales y faltante pendiente tras agregar | No existe ese detalle completo |
| Asignar break desde el mapa | Acción dentro del flujo de excedentes, con plan de break válido dentro del turno | Solo queda editar el break en los controles del colaborador |
| Reubicar subtramos compatibles | El plan omite huecos, breaks y minutos sin excedente/faltante; conserva las asignaciones fuera de los subtramos | La validación actual exige que el intervalo completo sea trasladable |
| Avisos de plan BUK | Panel de diferencias antes de exportar; distingue advertencias de guardado y validación del archivo | Falta ese panel y su detalle de motivos |
| Preferencia de día libre | La versión publicada la trata como advertencia, manteniendo separado el conflicto académico real | La versión recuperada vuelve a bloquear el turno como día libre solicitado |

La última fila es una diferencia comprobada de frontend. Antes de restaurar ese
comportamiento hay que contrastarlo con las funciones y reglas vigentes del
backend; esta auditoría no cambió ni verificó esas reglas remotas.

## Solicitudes nuevas que no se deben confundir con regresiones demostradas

- La tarjeta de cobertura con «turno de ayer» siempre visible: la vista clásica
  sí conserva contexto del día anterior, y la versión publicada tenía ficha
  rápida; no se encontró ese renglón permanente en la tarjeta publicada.
- Cumpleaños directamente en la tarjeta de cobertura: se encontró el indicador
  en la vista clásica, no en el cuerpo de las tarjetas publicadas auditadas.
- Feriado nacional destacado en el selector de los siete días: no se encontró
  ese destacado en la barra publicada. Es distinto del feriado compensado de un
  colaborador, cuya acción rápida sí existía.
- Sustituir «Revisar horas semanales» por un pendiente de programación específico:
  la versión publicada también contiene el aviso genérico. La propuesta del chat
  mejora su explicación, pero no debe presentarse como una función antigua probada.

## Evidencia preservada

En `output/recovery-audit/` de esta copia de trabajo se conservan:

- `hosting-history.json`: metadatos de 300 releases consultados, sin credenciales.
- `files-05fc44d79cbcfeff.json`: inventario de archivos de la versión de referencia.
- `historical-index.html` y `historical-main.js`: contenido público de esa versión.
- `historical-main.pretty.js`: formato legible del JavaScript publicado.
- `published-WeeklyScheduleEditor.js`, `published-ScheduleFocusStaffPanel.js`,
  `published-ScheduleFocusToolbar.js`, `published-ScheduleHeatmapMatrix.js` y
  `dependency-*.js`: extracciones para estudiar las implementaciones reales.
- `component-differences.json`: controles y marcadores ausentes en la versión actual.
- `recovered-heatmap-drag.jsx`: implementación anterior encontrada en un objeto
  de Git sin rama. Es una evidencia adicional; el arrastre de tarjetas más reciente
  se confirmó en el JavaScript publicado, no solo en ese objeto antiguo.

Las extracciones del bundle **no son un árbol fuente original completo**. El
release no incluye mapas de fuente. No se han copiado componentes minificados a
`src/` ni se ha supuesto que sean módulos independientes listos para compilar.

Se creó una copia temporal del release histórico para comparar el frontend:
https://lc-scheduler--audit-before-regression-ghfgs6ev.web.app
Caduca el 11 de noviembre de 2026 a las 16:59 de Lima. Crear la copia no cambia
producción ni el backend; tampoco se inició sesión con una cuenta real.

## Base para recuperar sin volver a perder cambios

La recuperación debe usar como referencia funcional la versión publicada del
2 de noviembre, recuperar también sus servicios/controladores dependientes y
preservar las exportaciones de Excel recientes. El PR #5 se debe integrar después
de contrastar sus cambios con esa base: el límite 26:00, las métricas y los nuevos
consumidores de proyección no están en la rama sobre la que se preparó.

La prueba de aceptación debe cubrir los flujos anteriores con datos ficticios:
tarjeta → mapa, día libre/compensación, deshacer/rehacer, guardado explícito,
historial y vista semanal, conteos y métricas por cuarto, breaks, categorías,
semanas contiguas y cancelación cuando cambian la tienda, fecha o disponibilidad.
