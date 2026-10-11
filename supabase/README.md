# Diseño Firebase → Supabase

Este directorio contiene el primer diseño declarativo de PostgreSQL para trasladar la información utilizada por la aplicación.

El proyecto activo de Supabase ya fue creado y el esquema, la importación y el endurecimiento RLS fueron aplicados. Los archivos se conservan como fuente versionable para reproducir el entorno sin depender de Firebase.

## SQL aplicado

- `schema.sql`: tablas, índices y políticas iniciales.
- `security_hardening.sql`: vinculaciones de identidad y tienda reforzadas.
- `hr_cessation_sync.sql`: reconciliación y sincronización transaccional entre `staff_profiles` y `cessations`.
- `staff_management.sql`: alta y edición transaccional de colaboradores y vínculo interno con Auth.
- `study_schedule_management.sql`: reemplazo atómico de disponibilidad con bloqueos de carnet y tienda.
- `migrations/*_training_signatures_storage.sql`: bucket privado y políticas RLS para firmas de evaluaciones.
- `migrations/20261011031701_scope_cessation_account_name_cleanup.sql`: corrige el borrado temporal de nombres al retirar cuentas por cese. Usa las cuentas eliminadas por la misma sentencia y mantiene la protección `safeupdate` activa.

Las futuras modificaciones deben aplicarse como migraciones y mantener estos archivos declarativos alineados con producción.

Instalada el 11/10/2026 en `nwwnnnjppycdrbeuzhnf`: `migrations/20261011130351_staff_profile_photos.sql`, para foto propia y bucket privado del fixture. La versión local coincide con el historial remoto; no volver a aplicarla al mismo proyecto. Implementación, pruebas y verificación del despliegue en [Fotos de perfil](../docs/CONCURSO.md#fotos-de-perfil).

Después instalar `migrations/20261011063222_competition_profile_recognition.sql`: laureles por campeonato y certificación al 100% por avance oficial, con recálculo ante correcciones y conservación de la capacitación independiente. Ver [Laureles y certificación automática](../docs/CONCURSO.md#laureles-y-certificación-automática). Ambas migraciones están probadas localmente; el acceso CLI disponible no incluye el proyecto de producción configurado.

El procedimiento de rate limiting, alertas, backup y recuperación se mantiene en `operations/PRODUCTION_RUNBOOK.md`; la verificación posterior a una restauración está en `operations/recovery/verify_restore.sql`.

La Edge Function `staff-account-admin` requiere el secreto `APP_URL` con la URL pública de Next.js. Hasta configurarlo no enviará invitaciones, evitando enlaces que redirijan por error a la aplicación Firebase anterior.

## Decisiones principales

- Los UUID internos de PostgreSQL reemplazarán progresivamente los IDs de Firestore.
- `firestore_id` y `firebase_uid` conservan la trazabilidad durante la migración.
- Fechas civiles se guardan como `date`; horas como `time`; eventos técnicos como `timestamptz`.
- Los horarios laborales se normalizan en `schedule_weeks` y `schedule_shifts`.
- Los horarios de estudio se normalizan por día y bloque.
- Configuraciones altamente variables permanecen en `jsonb` hasta estabilizar su forma.
- `legacy_data` conserva campos no reconocidos durante la importación para evitar pérdida de información.
- Todas las tablas públicas tienen RLS habilitado.
- Roles y tienda se consultan desde `user_profiles`, no desde metadatos editables del usuario.

## Colecciones cubiertas

| Firebase | PostgreSQL |
|---|---|
| `users` | `user_profiles` |
| `stores` | `stores` |
| `staff_profiles` | `staff_profiles`, `staff_skills` |
| `schedules` | `schedule_weeks`, `schedule_shifts` |
| `study_schedules` | `study_schedule_days`, `study_schedule_blocks` |
| `schedules` + feriados legales | `schedule_weeks`, `schedule_shifts`, `worked_holidays`, `official_holidays` |
| `feriados_trabajados`, `worked_holidays` | `worked_holidays` |
| `extra_hours` | `extra_hours` |
| `ceses` | `cessations` |
| `schedule_requests` | `schedule_requests` |
| `training_evaluations` | `training_evaluations` |
| `stores/*/config` | `store_configs` |
| `stores/*/positioning_requirements` | `store_positioning_requirements` |
| `positioning_requirements` | `store_positioning_requirements` (requiere asignar tienda) |
| `stores/*/sales_config` | `sales_month_configs` |
| `stores/*/sales_history` | `sales_daily_history` |
| posiciones de proyección | `store_positions`, `staff_skills` |
| venta horaria | `sales_hourly_history` |
| `config/schedule_projection` | `sales_projections`, `sales_projection_hours`, `staffing_projection_hours` |

## Pendientes de la migración funcional

1. Aplicar y verificar la migración del bucket privado de firmas en el proyecto remoto.
2. Configurar `APP_URL` para invitaciones y activar la protección de contraseñas filtradas en Supabase Auth.
3. Ejecutar pruebas de aceptación por rol contra el proyecto remoto.
4. Hacer una exportación incremental, conciliar duplicados y completar el corte definitivo de Firebase.

## Orden de migración recomendado

1. `stores`
2. Supabase Auth y `user_profiles`
3. `staff_profiles` y `staff_skills`
4. horarios de estudio y laborales
5. feriados, horas extra, solicitudes y ceses
6. capacitación
7. configuraciones y ventas
8. auditoría y validación final

Referencia oficial: Supabase permite exportar colecciones de Firestore a JSON y transformarlas mediante hooks antes de importarlas en tablas PostgreSQL. Para este proyecto se necesitarán hooks porque varias colecciones contienen estructuras anidadas.

## Concurso de velocidad y calidad

Las migraciones `20260927053023_speed_quality_competition.sql` y `20260927053329_competition_foreign_key_indexes.sql` añaden el dominio de concursos, funciones transaccionales, RLS y vistas de ranking. Reutilizan `staff_profiles`, `stores`, la autorización privada existente y `audit_log`. Consulte `docs/CONCURSO.md` para configuración, pruebas, decisiones de cronometraje y despliegue.
