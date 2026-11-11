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

Se conservan las restricciones actuales de guardado para estudios hasta poder
contrastar las reglas remotas de Supabase. La consulta de esas reglas sigue
requiriendo un acceso de base autorizado; no se relajan solo en el frontend.

La evidencia pública extraída y los resultados de búsqueda se conservan en
`output/recovery-audit/` de la copia de auditoría y en
`output/production-main-release/branch-origin-snapshots.json` de la copia principal.
