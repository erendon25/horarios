# Operación, alertas y recuperación

## Objetivos

- RPO objetivo: 24 horas con backups diarios; reducirlo con PITR si el negocio requiere menos pérdida.
- RTO objetivo: 4 horas para restaurar, validar y redirigir la aplicación.
- Responsables: propietario de Supabase, responsable de aplicación y responsable de validación operativa.

## Rate limiting

- Supabase Auth protege login y recuperación; revisar `Authentication > Rate Limits` y habilitar CAPTCHA/Turnstile antes del corte.
- `staff-account-admin` permite 5 solicitudes por usuario cada 15 minutos mediante `consume_rate_limit`.
- Toda nueva Edge Function administrativa debe usar un bucket propio y responder `429` con `Retry-After`.
- Revisar semanalmente respuestas 429 en Logs Explorer para ajustar límites sin ocultar abuso.

## Sentry y alertas

Configurar en el entorno de build: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN`. El token no debe usar prefijo `NEXT_PUBLIC_`.

Crear estas alertas en Sentry para `production`:

1. Error nuevo o regresión: notificación inmediata por correo.
2. Pico de errores: 10 eventos en 5 minutos.
3. Usuarios afectados: 5 usuarios en 15 minutos.
4. Rendimiento: p95 superior a 2 segundos durante 15 minutos.
5. Disponibilidad: monitor HTTP del login cada 5 minutos desde dos regiones; alertar después de dos fallos.

Validar enviando un error controlado en un entorno de prueba y comprobando evento, source map y notificación. No habilitar una ruta pública que genere errores en producción.

## Backup

1. Confirmar diariamente en Supabase `Database > Backups` que existe un punto reciente y registrar fecha, tamaño y responsable.
2. En plan Free, generar un dump lógico externo semanal. En Pro o superior, conservar además los backups diarios; evaluar PITR según el RPO.
3. El backup de base de datos no contiene archivos de Storage. Exportar por separado el bucket `training-signatures`, manteniendo rutas y checksums.
4. Respaldar también:
   - migraciones SQL y Edge Functions desde Git;
   - configuración de Auth, dominios, SMTP y rate limits;
   - nombres de secretos, nunca sus valores dentro de Git;
   - configuración de Sentry y hosting.
5. Cifrar los respaldos, restringir acceso y mantener una copia fuera de Supabase.

## Simulacro de restauración

Ejecutar mensualmente y antes del corte de Firebase:

1. Elegir el backup anterior al punto de prueba y registrar el objetivo de recuperación.
2. Restaurar a un proyecto Supabase temporal, nunca encima de producción durante un simulacro.
3. Reconfigurar manualmente Auth, claves, Edge Functions, Storage, SMTP y dominios.
4. Restaurar los objetos de Storage y comparar cantidad y checksums.
5. Ejecutar:

   ```powershell
   psql $env:RESTORE_DATABASE_URL -f operations/recovery/verify_restore.sql
   ```

6. Ejecutar pruebas de aceptación como colaborador, entrenador, admin y superadmin.
7. Verificar login, horarios de la semana, colaboradores, ventas, evaluaciones y firmas.
8. Registrar duración real, pérdida de datos observada, errores y acciones correctivas.
9. Eliminar de forma segura el proyecto temporal al cerrar el simulacro.

## Recuperación ante incidente

1. Declarar el incidente, congelar despliegues y registrar la hora de inicio.
2. Determinar si el fallo es de aplicación, configuración, Storage o base de datos.
3. Preservar logs y tomar un respaldo lógico si la base todavía responde.
4. Seleccionar el punto de restauración inmediatamente anterior al daño.
5. Comunicar la ventana de mantenimiento: una restauración vuelve el proyecto temporalmente inaccesible.
6. Restaurar, reconfigurar elementos externos y ejecutar `verify_restore.sql`.
7. Validar los cuatro roles antes de reabrir escrituras.
8. Vigilar Sentry, logs, errores 429 y métricas durante al menos una hora.
9. Documentar causa raíz, datos perdidos, RPO/RTO real y prevención.

Referencias: documentación oficial de backups de Supabase y configuración de alertas de Sentry.
