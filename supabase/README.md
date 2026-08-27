# Diseño Firebase → Supabase

Este directorio contiene el primer diseño declarativo de PostgreSQL para trasladar la información utilizada por la aplicación.

El proyecto activo de Supabase ya fue creado y el esquema, la importación y el endurecimiento RLS fueron aplicados. Los archivos se conservan como fuente versionable para reproducir el entorno sin depender de Firebase.

## SQL aplicado

- `schema.sql`: tablas, índices y políticas iniciales.
- `security_hardening.sql`: vinculaciones de identidad y tienda reforzadas.
- `hr_cessation_sync.sql`: reconciliación y sincronización transaccional entre `staff_profiles` y `cessations`.
- `study_schedule_realtime.sql`: publicación Realtime de cambios de horarios de estudio, protegida por RLS.
- `staff_management.sql`: alta y edición transaccional de colaboradores y vínculo interno con Auth.
- `study_schedule_management.sql`: reemplazo atómico de disponibilidad con bloqueos de carnet y tienda.
- `migrations/*_training_signatures_storage.sql`: bucket privado y políticas RLS para firmas de evaluaciones.
- `migrations/20260827014446_restore_authenticated_private_schema_usage.sql`: restaura únicamente `USAGE` del esquema privado requerido por las RPC autenticadas de horarios.
- `migrations/20260827030014_harden_collaborator_linkage.sql`: identidad canónica colaborador↔cuenta, RLS por tienda, skills, feriados, horas extra y ceses transaccionales.
- `migrations/20260827030023_repair_sales_history_transactions.sql`: transacciones horarias canónicas, reconstrucción derivada y carga atómica del historial de ventas.
- `migrations/20260827030741_cover_sales_hourly_parent_fk.sql`: índice compuesto para mantener eficientemente la relación venta diaria→horaria.
- `migrations/20260827032914_require_email_match_for_staff_claim.sql`: limita el reclamo de fichas a correos verificados coincidentes y a `service_role`.
- `migrations/20260827033202_preserve_cessation_details_on_profile_edit.sql`: evita que una edición general borre el detalle histórico del cese.
- `migrations/20260827033452_close_trainer_read_and_store_transfer_gaps.sql`: cierra lecturas de entrenadores desvinculados y traslados de tienda no transaccionales.
- `migrations/20260827033923_preserve_unspecified_cessation_fields.sql`: conserva campos de cese omitidos por clientes anteriores.
- `migrations/20260827034332_protect_effective_cessation_history.sql`: protege los ceses efectivos contra borrado o reapertura genérica.
- `migrations/20260827035122_harden_identity_evaluation_and_training_state.sql`: inmoviliza identidad vinculada y evaluaciones completadas, y agrega el cierre transaccional de entrenamiento.
- `migrations/20260827035340_allow_net_sales_adjustments.sql`: admite notas de crédito por canal/hora sin romper la conciliación diaria de ventas y TRX.
- `migrations/20260827040025_harden_weekly_schedule_authorization.sql`: obliga a que el guardado semanal pase por los helpers canónicos y bloquea administradores de tiendas inactivas.
- `migrations/20260827040648_close_direct_identity_writes.sql`: elimina escrituras directas sobre identidad laboral y concentra los cambios en RPC limitadas.
- `migrations/20260827041048_protect_training_and_employment_history.sql`: inmoviliza episodios de capacitación y empleo ya cerrados.
- `migrations/20260827041309_validate_training_and_legacy_holidays.sql`: valida transiciones de capacitación y termina de normalizar feriados heredados.
- `migrations/20260827041944_save_sales_configuration_atomically.sql`: guarda la configuración mensual y el historial de ventas como una sola transacción.
- `migrations/20260827042604_reject_null_authorization_context.sql`: rechaza explícitamente cuentas inactivas o sin vínculo canónico en todas las RPC privilegiadas.
- `migrations/20260827044222_lock_training_evidence_and_templates.sql`: versiona el catálogo de evaluación, exige evidencia canónica e identifica como no verificadas las certificaciones históricas incompatibles.
- `migrations/20260827044230_import_geovictoria_staff_atomically.sql`: importa altas y reincorporaciones de GeoVictoria con procedencia tipada e idempotencia por episodio vigente.
- `migrations/20260827044917_keep_inactive_staff_identity_stable.sql`: conserva la identidad de un episodio marcado inactivo hasta que exista un cese o fin de capacitación efectivo.

Las futuras modificaciones deben aplicarse como migraciones, mantener estos archivos declarativos alineados con producción y ejecutar `operations/recovery/verify_restore.sql`. Ese verificador falla si una cuenta activa queda desbloqueada sin ficha canónica, si se rompe una relación colaborador/tienda, si vuelve a perderse el permiso mínimo de horarios de estudio o si los totales diarios y horarios de ventas dejan de coincidir.

> **Importante:** el historial remoto anterior a agosto de 2026 todavía contiene migraciones que no están representadas una-a-una en `supabase/migrations`; parte de esa base histórica vive en los SQL declarativos de este directorio. Hasta crear y conciliar una baseline completa, no se debe ejecutar `supabase db reset`, `supabase db push` ni `migration repair` contra producción. Las migraciones nuevas sí deben conservar exactamente la versión registrada remotamente y pasar el verificador antes y después de aplicarse.

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

1. Configurar `APP_URL` para invitaciones y activar la protección de contraseñas filtradas en Supabase Auth.
2. Resolver manualmente las excepciones de identidad/skills que están registradas en `private.staff_linkage_issues`; no se deben inferir identidades ambiguas.
3. Conciliar los DNI duplicados y completar los correos faltantes antes de invitar esas fichas.
4. Crear una baseline completa que reconcilie el historial remoto anterior a agosto de 2026.
5. Revisar las evaluaciones históricas registradas en `private.training_evidence_issues`; permanecen visibles, pero no acreditan skills ni estadísticas hasta que exista evidencia canónica verificable.

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
