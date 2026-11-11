# Origen y comportamiento del arrastre de colaboradores

## Resultado de la búsqueda

La base de la vista de cobertura está en `codex/competition-registration`, commit
`121a225` («publish coverage-focused scheduling and operational labor hours»).
Las reglas de distribución BUK por descanso ya aparecen en `fda8ba8`, y el filtro
de disponibilidad de estudios en `6ece9a4`, dentro de esa línea de historia.

La implementación posterior de tarjetas con **pintado durante el arrastre** se
comprobó en Firebase Hosting: versión `05fc44d79cbcfeff`, publicada el
**2 de noviembre de 2026, 19:48 de Lima**. Su entrada activa fue
`/assets/index-Fm_Fl8QJ.js`.

No se encontró esa implementación completa en las diez ramas remotas actuales,
sus historiales, los reflogs ni los ocho commits locales no alcanzables. También
se revisaron 165 árboles sin referencia, que contienen 26 instantáneas distintas
de los componentes implicados: solo apareció un arrastre anterior de rangos,
que no equivale al arrastre de tarjetas con jornada completa.

Por tanto, **no es posible confirmar el nombre de la rama original de esa versión
con los objetos disponibles**. La rama de la base y la publicación posterior son
evidencias distintas; no se atribuye la implementación completa a una rama sin
un commit que la respalde.

## Cómo funcionaba la versión publicada

1. La tarjeta iniciaba una sesión con token y alcance de cuenta, tienda, semana
   y día. `setDragImage` usaba un canvas transparente de 1×1, evitando arrastrar
   una copia visual de la tarjeta con el nombre.
2. `dragover` tomaba posición e ingreso del recuadro bajo el cursor. Agrupaba las
   actualizaciones con `requestAnimationFrame` y desplazaba el mapa en sus bordes.
3. La propuesta calculaba las asignaciones completas y reconstruía los colores
   del mapa con ellas, **sin escribir aún en el borrador**. Al mover el cursor,
   cambiaba la propuesta; al cancelar, reaparecía la cobertura original.
4. Para un turno nuevo exigía un ingreso exacto del catálogo aprobado. La duración
   venía de modalidad, descansos y cupos semanales disponibles; no creaba un turno
   genérico de quince minutos ni aproximaba otro ingreso. Si había varias salidas
   para el mismo ingreso, exigía elegir una.
5. Contrastaba ficha, estudios y semanas vecinas. Los cruces académicos se
   detectaban y marcaban como advertencias en intervalos de la previsualización;
   la disponibilidad sin verificar sí impedía aplicar. Guardado y exportación
   conservaban sus propias validaciones.
6. Al aplicar volvía a comprobar token, datos de origen, modalidad, plan y cupos.
   Gerentes/asistentes sin jornada debían definirla en la ficha; no se inventaba
   una duración para ellos. Una jornada existente conservaba su duración al moverse.

### Distribución del catálogo conservado

| Modalidad | Descansos | Distribución semanal de horas netas |
| --- | ---: | --- |
| Full-Time | 1 | 6 jornadas de 8 h; cada una ocupa 8 h 45 min con break |
| Part-Time | 1 | 5 de 4 h y 1 de 3 h 45 min |
| Part-Time | 2 | 5 de 4 h 45 min |
| Part-Time | 3 | 3 de 6 h y 1 de 5 h 45 min |
| Part-Time | 4 | 2 de 8 h y 1 de 7 h 45 min |

Los planes Part-Time suman 23 h 45 min netas. El cupo de cada duración se descuenta
con las jornadas ya asignadas, excluyendo el día que se está editando.

## Corrección de la recuperación

La recuperación `9488cef` omitía el pintado previo, dejaba la imagen nativa de
la tarjeta y abría un modal al soltar. Además, usaba para gerencia sin jornada un
intervalo manual de quince minutos. Esas diferencias motivaron la corrección.

La corrección vuelve a pintar la jornada completa durante el arrastre, elimina
la imagen de la tarjeta y aplica al borrador al soltar únicamente si la nueva
validación es correcta. Usa una franja de estado dentro del mapa y conserva la
alternativa con controles para teclado/táctil.

Colocar un turno mantiene abierto el panel de colaboradores y conserva su
búsqueda. La cabecera reúne leyenda y acciones en una fila, y breaks y métricas
en otra; las instrucciones quedan en Ayuda. El estado del arrastre ocupa la
línea del título, sin reservar una franja vacía que reste espacio al mapa.

La información del ocupante vuelve a aparecer en una ficha flotante junto al
recuadro al pasar el mouse o fijar el foco. Incluye nombre, puesto, hora y tramo,
con la salida identificada sin duración. La ficha no agrega filas a la cabecera,
funciona dentro del mapa maximizado y se retira al desplazar el mapa o con Escape.

El acceso a la información del panel utiliza el icono de información: mouse o
foco muestra el resumen semanal y hacer clic abre el modal de la ficha. Al cerrar
el modal se devuelve el foco al icono sin reabrir la vista previa sobre los filtros.

Buscar cobertura admite también coincidencias parciales, ordenadas por minutos
efectivos cubiertos y horas fuera del intervalo. Cada opción muestra el tramo
cubierto, los cuartos pendientes y el break, que no suma cobertura. Por ejemplo,
08:00–14:00 puede sugerir el turno aprobado 09:00–13:00, con 4 h cubiertas y 2 h
pendientes. Se conservan categoría, estudios, semanas vecinas y cuotas BUK; al
agregar se vuelve a leer la disponibilidad y el horario guardado antes de aplicar
la jornada completa al borrador. Guardar sigue siendo la acción de publicación.

Regresión de navegador: `scripts/verify-heatmap-hover-ui.mjs`,
`scripts/verify-coverage-partial-ui.mjs` y `scripts/verify-coverage-recovery-ui.mjs`,
con documentos ficticios aislados del backend de producción.

El modo **Mover** vuelve a estar disponible junto a la leyenda del propio mapa,
con **Ajustar movimiento** a su lado. Permite arrastrar celdas ocupadas, conservando
el desfase entre la celda agarrada y la entrada del turno. El desplazamiento es de
15 minutos y conserva duración, extras, turnos partidos, break y reposiciones.
Arrastrar y soltar aplica directamente al borrador: no abre otro recuadro ni exige
un modal de confirmación. Los ajustes solo se abren si se solicita esa acción.
Para puestos por rangos permite cambiar el puesto base o solo el tramo elegido.
La propuesta se pinta antes de editar el borrador; al soltar se consultan de nuevo
el perfil, los estudios y las tres semanas. Escape, salir del mapa o cancelar
durante una consulta descarta el movimiento. Los ajustes funcionan con teclado,
pantalla táctil y mapa maximizado. Se conserva el panel de colaboradores.

Como en la referencia publicada, el desplazamiento puede producir un horario
manual fuera del catálogo, conservando las horas y mostrando el aviso BUK.
La exportación conserva sus validaciones. Un movimiento que perdería un break
existente se rechaza; tampoco se relaja el bloqueo actual por estudios mientras
no se hayan contrastado las reglas remotas. Las pruebas específicas están en
`src/services/heatmapMove.test.js` y `scripts/verify-heatmap-move-ui.mjs`.

Se conservan las restricciones actuales de guardado para estudios hasta poder
contrastar las reglas remotas de Supabase. La consulta de esas reglas sigue
requiriendo un acceso de base autorizado; no se relajan solo en el frontend.

La evidencia pública extraída y los resultados de búsqueda se conservan en
`output/recovery-audit/` de la copia de auditoría y en
`output/production-main-release/branch-origin-snapshots.json` de la copia principal.
