# Prueba de cobertura en foco

La vista de cobertura es la entrada predeterminada del editor semanal. La vista clásica sigue disponible desde «Más → Vista clásica» y conserva `?vista=clasica` al actualizar la página; ambas usan el mismo borrador y los mismos controladores de horarios. El botón «Vista cobertura» permite volver al diseño nuevo.

El mapa ocupa el espacio principal. «Colaboradores» (o «Equipo» en teléfono) abre la lista lateral o el panel inferior. La búsqueda de esa lista y sus filtros no alteran el mapa. Seleccionar una persona abre su editor; volver conserva la búsqueda y el desplazamiento de la lista.

El editor reutiliza los horarios aprobados BUK, disponibilidad de estudios, breaks, posiciones por rangos, extras, descansos y feriados. La modalidad aparece junto al nombre: Full-Time verde y Part-Time violeta, tanto en la lista como en el editor. Las celdas cuadradas y franjas de 15 minutos se mantienen. El exceso siempre es rojo, también cuando corresponde a un entrenador; el entrenador que cubre una plaza requerida sigue naranja. Los exportadores comparten esa regla. Las exportaciones están en «Exportar»; generar, replicar y el reporte de extras están en «Más».

## Buscar cobertura en un faltante

1. Pulsar «Buscar cobertura» en la cabecera del mapa.
2. Tocar el primer y el último recuadro amarillo del mismo carril. El último recuadro incluye sus 15 minutos: para consultar 12:00–15:45 se seleccionan los cuadros 12:00 y 15:30.
3. Revisar la lista de colaboradores y los turnos aprobados que cubren el tramo completo. Los extremos se pueden elegir en cualquier orden; un tramo que atraviesa otro color se rechaza.

La lista incluye **solo personas sin turno ese día**, con habilidad registrada para el puesto y disponibilidad de estudios comprobada. No ofrece personas ya programadas, días libres, feriados compensados ni registros parciales de un turno. Respeta el plan de descansos, cuotas BUK, estudios del turno completo, cruces de medianoche y superposiciones conocidas. Cuando un turno necesita break, debe existir una ubicación posible fuera del hueco.

Se comprueba el faltante contra toda la tienda, incluso si el mapa muestra filtros. Las sugerencias se actualizan al cambiar estudios o turnos; cambiar semana, día o tienda invalida la selección. Las opciones que cruzan hacia una semana adyacente no cargada se excluyen. Los turnos compatibles pueden abarcar más tiempo que el hueco; siempre se muestra su rango real.

Consultar o pulsar «Ver en editor» no asigna ni guarda horarios. El editor se abre conservando los datos anteriores. La selección roja de traslados conserva su comportamiento independiente.

## Ejecutar la demostración local

Desde la copia de trabajo, con las dependencias instaladas:

```sh
BUK_QA_FOCUS_PREVIEW=1 BUK_QA_PORT=5173 node scripts/serve-buk-qa.mjs
```

Abrir `http://localhost:5173/?vista=cobertura` en la misma computadora. La demostración usa 21 colaboradores ficticios, autenticación simulada y documentos en memoria. No necesita `.env`, cuentas reales ni conexión con Supabase. «Guardar» solo modifica esa demostración.

El paquete exportado incluye los recursos compilados y un servidor que usa únicamente módulos de Node. Se inicia con `node iniciar.mjs --abrir`, sin instalar dependencias. El localhost pertenece a la computadora que ejecuta ese comando; no es un enlace remoto para teléfonos.

Para la prueba desde el teléfono se prepara una copia estática en un canal temporal de vista previa. Esa copia usa documentos ficticios en el navegador; no publica en el canal de producción ni modifica horarios reales.

## Comprobaciones

```sh
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs CHROMIUM_PATH=/ruta/a/chromium node scripts/verify-schedule-focus-ui.mjs
node --test src/services/heatmapCoverageCandidates.test.js
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs CHROMIUM_PATH=/ruta/a/chromium node scripts/verify-heatmap-coverage-ui.mjs
```

Se verifica la igualdad del mapa con la vista clásica, selección y búsqueda local, conservación del borrador al cambiar de vista, edición BUK/manual, breaks, días bloqueados, guardado ficticio y el panel móvil con diálogos superpuestos. Evidencia en `output/schedule-focus-qa/`.
