# Prueba local de BUK Asistencia

## Revisión de diseño y lógica

Esta revisión reemplaza el flujo inicial descrito más abajo. El selector aprobado se encuentra debajo de la modalidad; se retiró el control para crear horarios partidos. El botón principal PDF genera la planificación, con ingreso y salida en la fila superior de cada día y posición centrada debajo. Excel BUK reemplaza al botón GeoVictoria y obtiene nombre, DNI, tienda y gerente del sistema: no solicita plantilla ni ofrece copiar filas.

Feriado selecciona el primer horario aprobado del plan (Full-Time: 06:15–15:00). Se conservan datos históricos y horarios de otros días. Las extras no alteran BUK; sí amplían los horarios y totales del PDF compartido y del Excel de planificación. La prueba de una hora antes y dos después conserva 06:15–15:00 en BUK, muestra 05:15–17:00 en planificación y suma 51:00 semanales.

Pasaron las pruebas de navegador de estos cambios, las cinco modalidades del Excel y las 30 pruebas de regresión. Solo se actualizó el canal temporal https://lc-scheduler--buk-prueba-dbooagb2.web.app; producción sigue con su versión anterior.

No se desplegaron estos cambios a producción ni se modificaron horarios reales.

## Abrir la prueba

http://localhost:4179/ muestra el WeeklyScheduleEditor real con cinco colaboradores ficticios y un transporte aislado. La semana es del 12 al 18 de octubre de 2026. Guardar escribe únicamente en memoria de esta prueba. El heatmap usa su componente existente, sin modificaciones en esta tarea.

Para iniciarlo nuevamente desde la raíz del repositorio:

```sh
node scripts/test-buk-schedule.mjs
./node_modules/.bin/tailwindcss -i src/index.css -o /tmp/horarios-buk-qa.css
node scripts/serve-buk-qa.mjs
```

Prueba seleccionar un ingreso aprobado, comprobar la salida calculada, conservar o cambiar una posición y guardar. Descarga después Excel BUK, Excel planificación y PDF planificación. El selector Part-Time permite elegir un plan de uno a cuatro descansos; los descansos concretos se marcan con los controles existentes del editor. Seleccionar un plan no borra ni redistribuye días automáticamente.

El plan de descansos se comparte entre los siete días de la semana de cada colaborador y se conserva en el borrador y al guardar. Las selecciones antiguas que difieran entre días se interpretan con los descansos reales de la semana. Los rangos aprobados muestran su duración, incluso al cruzar medianoche; si incluyen refrigerio, también muestran las horas netas. Cambiar el plan conserva los horarios, posiciones, extras y breaks ya escritos; los turnos que queden fuera del nuevo plan se señalan para revisión.

La pestaña **HORARIOS APROBADOS** del archivo «Planificación de horarios(1).xlsm» es la referencia para los refrigerios. Se comprobaron sus 261 rangos y las reglas de A2, D2, G2, J2 y M2 contra el catálogo del programa. Las cuatro opciones Part-Time completan 23:45 semanales:

| Opción | Distribución | Refrigerio |
| --- | --- | --- |
| PT1 · 1 descanso | 5 turnos de 4:00 y 1 de 3:45 | Sin break |
| PT2 · 2 descansos | 5 turnos de 4:45 | Sin break |
| PT3 · 3 descansos | 3 turnos de 6:45 y 1 de 5:45 | 45 minutos solo en los de 6:45 |
| PT4 · 4 descansos | 2 turnos de 8:45 y 1 de 8:30 | 45 minutos en los tres |

El selector calcula las duraciones disponibles contando los otros seis días del colaborador. Después de cinco jornadas de 4:00 en PT1, solo ofrece 3:45; después de asignar la jornada corta, los demás días solo ofrecen las largas. PT3 y PT4 aplican el mismo límite por duración y PT2 admite cinco turnos de 4:45. El día que se está editando no consume su propio cupo. Las extras no cambian esta distribución; una compensación ocupa su rango base acreditado y un día libre no lo ocupa. El ingreso manual aprobado usa este mismo filtro para autocompletar la salida.

Los turnos ya guardados se conservan: si alguno supera la cantidad permitida, aparece seleccionado con un aviso y se ofrecen las duraciones disponibles para corregirlo. Para redistribuir la jornada corta, primero se libera su día actual. Pruebas: `node --test src/services/bukWeeklyQuota.test.js`; navegador: `node scripts/verify-buk-weekly-quota-ui.mjs` con la misma preparación de datos ficticios.

Full-Time conserva seis turnos de 8:45 con 45 minutos de refrigerio y 48:00 netas semanales. Los breaks aplicables se asignan desde el control del editor, se descuentan una sola vez del total y excluyen sus tres bloques del mapa de cobertura. La antigua excepción de break incluido en PT2 se retira: los horarios guardados se conservan y sus metadatos obsoletos de break no alteran el cálculo ni bloquean la exportación.

Comparación directa con el archivo: `node scripts/verify-buk-approved-workbook.mjs "ruta/al/archivo.xlsm"`. El script lee los encabezados y rangos sin ejecutar macros y guarda un informe en `output/buk-workbook/approved-audit.json`, sin extraer información del personal.

Regresión de selección semanal y refrigerios: `node --test src/services/bukWeeklyPlan.test.js src/services/bukApprovedRules.test.js`. Recorrido del editor con persistencia HTTP aislada: ejecutar primero `node scripts/test-buk-schedule.mjs` para crear los datos ficticios y después `node scripts/verify-buk-weekly-plan-ui.mjs` (requiere Playwright y Chromium). La prueba comprueba los siete días, entrada manual, borrador, guardado, recarga sin borrador, descansos marcados y desmarcados, breaks según la opción, descarga de ambos Excel, móvil y cambio al modo anterior, sin escribir en producción.

## Validaciones realizadas

- El reporte original tiene cuatro hojas, 29 identidades y 1.644 filas de catálogo semanal. Los nombres, DNI, área y supervisor se toman de la plantilla cargada; la asociación con el sistema se realiza por DNI.
- La planificación original tiene tres hojas y 261 pares de ingreso/salida aprobados. La fecha fija original era el 28 de septiembre de 2026. Las exportaciones nuevas calculan las siete fechas desde la semana seleccionada.
- Se llenó una copia sin macros del Excel original y se recalculó con LibreOffice. Los cinco planes resultaron en «HORARIO PROGRAMADO CORRECTAMENTE»: Full-Time 48:00; los cuatro planes Part-Time 23:45. Las 35 celdas de BUK coinciden con el generador del sistema.
- El XLS BIFF8 generado se reabrió y comparó, incluyendo ceros iniciales del DNI, fechas, descansos y celdas vacías.
- Pasaron 30 pruebas de regresión de horarios, descansos, posiciones y borradores.
- Las pruebas de navegador descargaron XLS y PDF reales, copiaron filas y comprobaron que elegir un ingreso calcula su salida sin alterar posiciones, extras ni otros días. También se probó guardar desde el editor semanal completo con el transporte aislado.
- El PDF contiene número, nombre, modalidad, cantidad de descansos, ingreso/salida/posición por día, horas netas y control semanal.

## Reglas de exportación

Un descanso explícito se exporta como `D`; un feriado explícito como `F`. Un día vacío o posterior al cese queda vacío: en BUK esto significa no modificar su asignación existente. No se convierte un vacío en descanso ni se genera `BASE` automáticamente.

Los turnos se resuelven contra el catálogo activo cargado. Si faltan DNI o turnos, existen duplicados o hay turnos partidos sin equivalente, la exportación se detiene y muestra el detalle. Las extras permanecen en el editor; el importador BUK recibe el turno base. El break elegido en el editor organiza la cobertura de la tienda: puede diferir de la colación fija de BUK sin bloquear la descarga. El código exportado y su colación permanecen como están definidos en el catálogo; no se generan códigos nuevos ni se modifican horarios guardados.

El refrigerio BUK pertenece a la definición del código de turno del catálogo de la plantilla; cambiar `breakStart` en el editor no cambia esa definición en BUK. Por ejemplo, `16:15 A 01:00` lleva `18:00–18:45` en el catálogo aportado. El editor muestra «Refrigerio BUK» debajo del rango aprobado. El archivo de importación conserva las cuatro hojas originales: la colación se consulta en `turnosSemanales`, columnas «Entrada de colación» y «Salida de colación», ahora con ancho suficiente para leerlas.

Excel planificación agrega la hoja informativa `REFRIGERIOS`, con colaborador, fecha, turno base, refrigerio BUK, break de cobertura y estado de comparación. También se puede consultar si el archivo indica `BUK PENDIENTE` por un turno inválido; exportarla no cambia breaks ni horarios guardados. Al descargar BUK, las diferencias de refrigerio se informan sin bloquear. Para usar otra hora también en BUK se necesita un código activo definido allí con ese refrigerio y actualizar el catálogo; no basta con editar las columnas auxiliares del XLS. Pruebas: `node --test src/services/bukRefrigerio.test.js` y el recorrido `verify-buk-weekly-plan-ui.mjs`.

La configuración de una plantilla cargada desde la aplicación normal se guarda por tienda. La prueba de localhost no usa esa conexión. La aceptación final del archivo por el importador real de BUK queda por comprobar con una importación controlada por el gerente.

Los archivos de ejemplo están en `artifacts/buk/`; contienen personal ficticio. El archivo `recalculado/PLANTILLA_ORIGINAL_PRUEBA.xlsx` conserva las fórmulas originales, sin macros, para revisar el cálculo.

## Producción: cambio reversible entre modos

El editor incluye «Modalidad de planificación»: BUK o Anterior / GeoVictoria.
BUK es la opción inicial. La preferencia se guarda por cuenta y tienda en el navegador
(`schedule_mode:<uid>:<storeId>`). No cambia los turnos ni descarta el borrador;
los cambios de horarios siguen requiriendo Guardar. En otro navegador se debe
seleccionar de nuevo la modalidad deseada.

Anterior recupera entrada/salida manuales (sin autocompletar BUK), horario partido,
PDF anterior y Excel GeoVictoria (requiere su catálogo de turnos existente).
BUK recupera turnos aprobados, autocompletado y exportaciones BUK/planificación.
Los descansos/breaks de horarios ya guardados se conservan: cambiar la vista no
reescribe el horario ni elimina metadatos BUK.

Verificación: `node scripts/verify-buk-mode-switch.mjs` con el editor aislado en
4179 prueba alternancia en ambos sentidos, persistencia tras recargar, conservación
del borrador y ausencia de escrituras remotas. Los 30 controles de horarios y las
pruebas de Excel BUK también pasan.

Antes del despliegue se clonó la versión de producción al canal Firebase
`antes-buk`: https://lc-scheduler--antes-buk-vgke227b.web.app . Este respaldo de
Hosting tiene caducidad; no constituye un respaldo de la base de datos.
Para revertir todo el frontend durante su vigencia:
`firebase hosting:clone lc-scheduler:antes-buk lc-scheduler:live --project lc-scheduler`.
La reversión de Hosting no modifica los datos de horarios.

### Gerentes y asistentes: horarios libres

GERENTE y ASISTENTE pueden ingresar cualquier hora de entrada/salida. No usan
selector de turnos aprobados ni autocompletado de salida. El PDF y Excel de
planificación conservan sus horarios, posiciones y totales; el control indica
HORARIO LIBRE. En turnosColaboradores BUK se mantienen sus datos identificatorios
pero sus siete casillas quedan vacías (no modificar en BUK), incluyendo descansos
y feriados. La excepción no aplica a ENTRENADOR/TRAINER.
Pruebas: `node scripts/test-buk-management-exemption.mjs`; editor aislado con
`BUK_QA_MANAGEMENT=1 node scripts/serve-buk-qa.mjs` permite verificar ambos cargos.


## Correcciones de cobertura y feriados

- El mapa conserva la marca visual de la hora de salida: una salida a las 17:45
  pinta también 17:45 y una salida a 01:00 pinta 25:00. Los turnos base y rangos
  que terminan con el turno usan el mismo criterio. En un relevo exacto se cuenta
  solo al colaborador que empieza. Los cambios internos tienen fin exclusivo
  para que el puesto destino o el puesto base retomado sea el único que cubra
  ese punto. Este pintado no añade minutos al horario ni a sus totales.
- El exceso es una condición independiente del color. Los entrenadores conservan
  el naranja y pueden ser seleccionados para reasignación cuando están en exceso.
- Guardar respeta `feriado` como estado principal y usa `holiday` solo como
  compatibilidad si aquel no existe. Al editar se sincronizan ambos. Un borrador
  antiguo con `feriado: false, holiday: true` ya no reactiva la compensación.
- La función de guardado reemplaza los movimientos de feriados de esa semana en
  la misma transacción que los turnos; desmarcar y Guardar retira la compensación.

Pruebas: firestoreCompat (guardado y recarga), positionCoverage, heatmapTransfers,
weeklyScheduleExcel, heatmapExport y navegador con verify-heatmap-transfers.

El control de break también está disponible debajo de la entrada en
Anterior / GeoVictoria. La verificación del cambio de modalidad abre el selector,
asigna un break y comprueba el botón con la hora elegida. Los breaks asignados
siguen excluyendo sus tres bloques de 15 minutos en el heatmap.
