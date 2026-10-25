# Turnos compatibles con estudios

El editor semanal y las solicitudes de horario usan la disponibilidad de estudio del perfil del colaborador. El identificador del perfil tiene prioridad sobre el de su cuenta de acceso.

- Los selectores conservan las reglas BUK de modalidad, descansos y duración restante de la semana, y eliminan las opciones que se cruzan con estudios.
- «Solicitar día libre» en disponibilidad bloquea todo ese día. Sin un registro de estudios no se inventan restricciones; una lectura fallida se muestra como error con reintento y bloquea nuevas entradas y salidas.
- Se comprueban todos los bloques, los turnos nocturnos, el estudio del día anterior que continúa después de medianoche y las horas extra. Un turno puede terminar cuando empieza una clase, o empezar cuando termina. No se añade margen de traslado.
- El break organiza la cobertura de la tienda; no permite seleccionar un turno que contiene horas de estudio. Los tramos históricos partidos se comprueban por separado.
- Gerentes y asistentes mantienen sus rangos manuales y su exclusión del archivo BUK, con la misma comprobación de estudios.
- Los turnos previamente guardados se conservan, aunque el colaborador cambie después su disponibilidad. Se señalan para revisión. Cambiar solamente puesto, notas o break no obliga a eliminar un turno histórico.
- Replicar una semana omite los nuevos turnos incompatibles y comunica cuántos omitió. La generación de horarios respeta estudios y conserva los días que ya tenían un turno o descanso.

## Solicitudes

«Horario específico» ofrece las opciones aprobadas compatibles. Apertura, medio y cierre siguen siendo preferencias para que gerencia determine el rango final; se requiere que exista algún turno compatible en esa fecha. Solicitar no cambia el horario publicado.

Antes de enviar se vuelven a consultar estudios y plan semanal. La base de datos comprueba los rangos concretos al crear una solicitud y al aprobarla. Si los estudios cambiaron y ya existe conflicto, la operación se rechaza y la solicitud permanece pendiente. Al guardar horarios se validan los rangos nuevos o modificados antes de escribir la semana.

## Verificación

Pruebas locales sin personal ni solicitudes reales:

```sh
node --test src/services/shiftAvailability.test.js
PGLITE_MODULE=/ruta/a/@electric-sql/pglite/dist/index.js node scripts/test-study-availability-db.mjs
PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs node scripts/verify-study-availability-ui.mjs
```

La prueba SQL utiliza RLS y las funciones de guardado y aprobación. La prueba de navegador usa los componentes reales con un transporte local, y comprueba el tratamiento visual de un rechazo de aprobación; esa última petición no se dirige a producción.
