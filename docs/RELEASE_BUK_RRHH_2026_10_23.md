# Publicación independiente de BUK y RR. HH.

Esta versión parte de `1836d20`, la versión publicada el 17 de octubre, e incorpora los cambios de BUK y RR. HH. revisados en `07aed8e`.

- El editor usa BUK como única modalidad e ignora la preferencia antigua del navegador. Conserva horarios guardados y borradores; el Excel de planificación permanece como reporte complementario.
- El panel de RR. HH. reúne el registro de feriados pagados y el avance de entrenamiento. La plantilla distingue gerente, asistente, full time, part time y entrenamiento; los carnets se pueden ordenar por fecha. Se retiran los controles de GeoVictoria y carnets críticos solicitados.
- Ventas, análisis y venta sugestiva conservan la versión anterior de producción. Su actualización completa sigue preparada en `07aed8e`; necesita acceso a Supabase para aplicar las dos migraciones nuevas.

No requiere SQL nuevo ni modifica datos de horarios al desplegarse. El destino es únicamente Firebase Hosting `lc-scheduler`.

Validación: build de producción correcto, prueba BUK único 3/3 y plan semanal 10/10 en este checkout aislado. Se verificaron horarios históricos, borradores, guardado, recarga, exportación y móvil con datos ficticios. El artefacto compilado no contiene el selector «Modalidad de planificación» ni recupera `schedule_mode:`.
