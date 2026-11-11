# Recuperación de cobertura

La referencia funcional es el release `05fc44d79cbcfeff` documentado en
`AUDITORIA_COBERTURA_PUBLICADA_2026_11_10.md`. La implementación se integra sobre
`main` actual, conservando la proyección de 15 minutos, los descansos asignados
y las exportaciones recientes. Los bundles históricos se usaron para contrastar
comportamientos, sin incorporarlos como módulos de la aplicación.

## Funciones recuperadas

- Tarjetas arrastrables a posición y hora del mapa, propuesta de turno aprobado,
  selección de alternativa y confirmación al borrador.
- Alternativa al arrastre mediante controles accesibles; movimiento de turnos
  existentes sin modificar su duración aprobada.
- Sesiones con token y alcance de cuenta, rol, tienda, semana y día. Las
  respuestas tardías de una sesión cancelada no pueden escribir al borrador.
- Relectura de ficha, estudios y semanas contiguas antes de proponer y aplicar.
  Cambios del turno de origen o de su disponibilidad invalidan la operación.
- Libre y feriado compensado en la tarjeta, con confirmación de reemplazo.
- Deshacer/rehacer con historial agrupable, límite de 100 entradas y nuevo
  checkpoint después de guardar. Un cambio nuevo elimina el redo anterior.
- Guardar, estado y error desde el panel; vista previa de turnos y breaks de
  toda la semana, agrupados por categoría.
- Ficha rápida, filtros de modalidad y categoría, y edición de categoría con el
  acceso habitual del administrador. Personas sin categoría quedan explicadas
  como excluidas de las sugerencias hasta asignarles una.
- Faltantes/excedentes ponderados por 0,25 h, desglose por área, indicación del
  alcance filtrado y estados de carga/error.
- Personas distintas por cuarto, rango mínimo/máximo por hora, detalle de
  personas y posiciones, sin sumar breaks ni marcas de salida.
- Identidad en celdas al pasar el mouse o enfocar, selección del colaborador,
  ficha y marca de salida; mapa extendido hasta 26:00, sin duración en el extremo.
- Agregar un turno desde la búsqueda de cobertura, con revalidación, categoría,
  motivos de exclusión y faltante restante después de agregar una persona.
- Break desde el formulario del mapa, dentro de un turno válido; traslados por
  subtramos compatibles que omiten huecos, breaks y minutos sin excedente/faltante.
- Advertencias del plan semanal/BUK antes de exportar, separadas del guardado y
  de las validaciones propias del archivo.

Además se incorporan las mejoras de contexto pedidas en el chat: turno anterior
en la tarjeta, cumpleaños, explicación específica de las horas pendientes y
feriados nacionales destacados en el selector. Estas mejoras no se presentan
como funciones históricas demostradas.

## Comprobación pendiente del servidor

La preferencia de descanso de estudios se conserva con la regla actual del
código confirmado. El frontend histórico la trataba como advertencia, pero la
migración local de disponibilidad la bloquea. No se ha relajado solo el
frontend ni se han cambiado funciones de la base sin verificar su estado real.

Tras renovar la sesión de Supabase, el proyecto se identifica correctamente,
pero la consulta SELECT de sus funciones devuelve 403 por permisos de base de
datos insuficientes. Se solicitó habilitar lectura de base o usar la cuenta
propietaria para comprobar esa diferencia. No se modificaron datos operativos
ni reglas remotas durante esta recuperación.

## Verificación

- 427 pruebas de lógica aprobadas y 3 omitidas, incluidas 11 de recuperación.
- Navegador con documentos ficticios: arrastre real, alternativa con controles,
  movimiento, cancelación durante una consulta pendiente, revalidación de
  estudios, acciones rápidas, historial, fichas, categorías, vista semanal,
  búsqueda, guardado/recarga y feriados en móvil.
- Regresiones de la vista de cobertura: BUK, extras, partidos históricos,
  breaks, borrador, guardado explícito, foco y espacio del mapa en móvil.
- Build correcto. La publicación utiliza los controles de `main` configurados
  en `firebase.json`; no se promociona el bundle histórico sobre la aplicación.
