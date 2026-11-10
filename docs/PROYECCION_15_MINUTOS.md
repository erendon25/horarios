# Proyección por tramos de 15 minutos

La tabla permite editar cada cuarto de hora por separado. Los datos históricos
disponibles están agregados por hora: cada venta horaria se reparte por igual
entre sus cuatro tramos. Esta distribución conserva los ingresos diarios y
semanales; no representa un histórico observado con precisión de 15 minutos.

VHL y capacidades de Servicio/Driver siguen expresados por hora. Los cálculos
normalizan la venta del tramo a esa escala; la dotación, sus factores, mínimos
y topes no se dividen por cuatro. Las horas requeridas suman dotación × 0,25.

La configuración guarda `manualStaffIntervalMinutes: 15`. Los ajustes horarios
anteriores se expanden en cuatro valores al cargar y cada cuarto pasa a poder
editarse de manera independiente. No se borran campos de otras configuraciones.
Cada matriz derivada guarda `intervalMinutes: 15` y `startMinutes`, además de
posiciones y cantidades. Las matrices anteriores sin esos campos conservan su
interpretación histórica: una hora por columna desde las 08:00.

El mapa, sus búsquedas de cobertura, las validaciones de movimientos, los
totales HH y las exportaciones usan la escala temporal de cada matriz. También
se preservan índices dispersos para no desplazar posiciones ni intervalos.

La tabla tiene una columna fija de 160 px y columnas temporales de 40 px. La
lógica del área se resume bajo el nombre y su fórmula completa queda en el
tooltip. Las entradas numéricas tienen 32 px de alto y se reducen las tarjetas
de resumen. El scroll horizontal queda dentro de la tabla en móvil. Los
ajustes de personal admiten clic/Enter para sumar y Ctrl + clic/Enter para restar.

Validación local: las 396 pruebas previas de servicios pasan; ocho pruebas nuevas
cubren cuartos, medianoche, compatibilidad horaria, HH, índices dispersos,
movimientos y Excel. Cuatro escenarios nuevos de navegador comprueban guardado,
recarga, aislamiento entre tiendas y dimensiones en escritorio/móvil. Las
suites de demanda (siete escenarios) y fracciones (tres escenarios) comprueban
que se conservan las fórmulas y la precisión. Las pruebas usan datos ficticios.

Los ejemplos de tarjetas de colaboradores, cumpleaños y feriados presentados en
el chat son propuestas visuales independientes; no forman parte de este cambio.
