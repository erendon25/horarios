# Concurso de velocidad y calidad

## Inspección y decisiones

La aplicación publicada es React 18 + Vite 6, JavaScript/JSX en `src/`; `web/` contiene otra aplicación Next.js y `android-app/` un cliente Android. Firebase Hosting sirve `build/` mediante `firebase.json`. El módulo no cambia esos archivos de configuración ni usa Firestore.

La sesión se obtiene de `AuthContext` y `src/lib/supabase/client.js`. `user_profiles.id` referencia Auth; `staff_profile_id` referencia `staff_profiles.id`; `store_id` referencia `stores.id`. Roles existentes: superadmin, admin, trainer, collaborator. Las funciones privadas `current_user_role`, `current_user_store_id` y `current_staff_profile_id` verifican actividad y vínculo laboral. El módulo reutiliza estas funciones.

Se inspeccionaron esquema, migraciones, políticas remotas, rutas, dashboards, servicios, hooks y configuración de despliegue. La base remota no contenía tablas de concurso antes de estas migraciones. `training_evaluations` es capacitación laboral con firmas y no sirve como evaluación cronometrada multietapa. `audit_log` sí sirve y se reutiliza con snapshots y eventos de dominio en `new_data`. No se crean personas: los equipos enlazan UUID de `staff_profiles`. Los nombres de exhibición son snapshots, sin DNI, correo u otros datos laborales; esto permite mostrar compañeros sin abrir los permisos de sus fichas.

## Esquema propuesto

- `competitions`: tienda, calendario, límites y estado.
- `competition_teams`, `competition_team_members`: trainer e integrantes referenciados por UUID.
- `competition_areas`, `competition_phases`, `competition_rubric_items`: reglas configurables y fixture independiente por área.
- `competition_entries`: inscripción integrante/área, fase y estado.
- `competition_evaluations`, `competition_evaluation_scores`: intentos, reloj y rúbrica normalizada con snapshots.
- `competition_timer_events`: inicio, pausa, reanudación, parada y cancelación con reloj PostgreSQL.
- Vistas con `security_invoker`: ranking individual, equipos/trainers y fixture. Totales derivados, sin contadores de puntos.

Todas las tablas tienen RLS de lectura por tienda. Las escrituras solo se permiten mediante RPC: las acciones administrativas validan rol y tienda; la inscripción personal obtiene el perfil del usuario autenticado en el servidor y solo permite registrar o retirar sus propias áreas en borrador. Un entrenador no recibe privilegios de administrador. La implementación privilegiada reside en `private`, con wrappers invoker en `public`, siguiendo las migraciones existentes.

Cada comando bloquea la fila del concurso. Esta granularidad sacrifica concurrencia de escrituras dentro de un concurso pequeño a cambio de serializar configuración, inscripciones, cronómetros y puntuación de forma consistente. El reloj se toma después del bloqueo. La visualización usa hora PostgreSQL y `performance.now()`; nunca envía timestamps autoritativos.

## Reglas operativas

Los tiempos máximos NO se deducen de los ejemplos: deben configurarse antes de activar. Calidad mínima 90; fases 1/2/3/5; bonus campeón 3; máximo 2 áreas por persona y 6 integrantes por equipo. Los nombres sugeridos requieren revisión y asociación por UUID.

La inscripción personal está en **Inscripción**, con botón por área y retiro disponible mientras el concurso esté en borrador. Se permiten como máximo 2 integrantes de un mismo equipo en cada área, además del límite de áreas por persona. El administrador debe formar los equipos primero. Para activar, cada área que tenga inscripciones necesita al menos 2 inscritos elegibles; las áreas vacías no compiten. Se valida nuevamente ese mínimo antes de iniciar la primera evaluación del área. Una vez que el área ya tuvo resultados, la eliminación deportiva puede dejar un único finalista sin incumplir el mínimo inicial.

Los perfiles de RR. HH. en estado `pending` también pueden asociarse al concurso si no tienen cese efectivo; ese estado es el valor inicial de los perfiles creados y no equivale a un cese. Las cuentas que se inscriben sí requieren una sesión activa y un vínculo válido. El selector muestra inactivos y cesados deshabilitados con motivo. No se activan ni modifican perfiles de RR. HH. automáticamente. Los líderes ven en **Mi concurso** las áreas y fases de todos los integrantes de su equipo.

Al activar se guarda un sorteo por área con turnos y cruces, alternando equipos cuando es posible. Los grupos son de 2; con un total impar el último grupo tiene 3 para evitar una persona sola. El sorteo persiste al recargar y se audita. Los cruces organizan las evaluaciones: el avance sigue dependiendo del umbral de calidad y tiempo, y la comparación entre finalistas decide el campeón. No existe eliminación directa por ganar un cruce. Volver a borrador antes de cualquier intento permite editar inscripciones y regenerar el sorteo al activar de nuevo.

Configuración, equipos y rúbricas se editan en borrador. Para proteger el historial, no se vuelve a borrador después de crear evaluaciones. Los límites y criterios de cada evaluación se copian al crearla. Los resultados guardados son inmutables; la corrección explícita de un resultado invalida ese intento y los posteriores del área/persona, revoca el campeón del área, recalcula puntos y exige motivo. La auditoría conserva los valores anteriores. Los intentos cancelados no otorgan puntos.

Aprobar avanza automáticamente. Fallar elimina; el administrador puede reabrir la participación con motivo para otro intento de la misma fase. Solo una evaluación aprobada por persona/área/fase otorga puntos. La declaración de campeón exige que todas las inscripciones del área terminen y no existan evaluaciones pendientes. Se compara calidad y luego tiempo entre finalistas aprobados. El empate genera una ronda de desempate exclusivamente entre empatados; sus evaluaciones no repiten puntos. Si todos fallan, se requiere otra ronda. El campeón se declara explícitamente cuando hay evidencia suficiente.

Una fecha de cese futura permite inscribir y evaluar al colaborador hasta el final de ese día, calculado en `America/Lima`. Se muestra la fecha en las opciones administrativas. A partir del día siguiente, o si el perfil pasa a inactivo, su participación figura como «Fuera de competencia»: no puede abrir, iniciar, reanudar ni guardar evaluaciones, ni recibir un título de campeón aún no declarado. Puede detenerse y cancelarse con motivo un intento que quedó abierto. Para resolver un área se omiten sus intentos pendientes; el administrador debe cancelar esos intentos para dejar el historial limpio. Los puntos oficiales anteriores, la pertenencia al equipo y los títulos ya declarados se conservan. El cese no crea vacantes ni redistribuye automáticamente integrantes, pues eso alteraría el sorteo y la puntuación ya conocidos. Si RR. HH. quita la fecha de cese y el perfil sigue activo, vuelve a ser elegible en el mismo grupo y sus inscripciones previas, sin asignación automática a otro grupo. Puede volver a evaluarse solo si el área y concurso siguen abiertos. Si una evaluación quedó abierta durante el cese, debe cancelarse antes de retomarla.

## Uso

1. Entrar en **CONCURSO** desde el panel administrativo, o **MI CONCURSO** desde el panel personal. Ruta: `/concurso`.
2. Crear concurso y seleccionar su tienda. En Equipos, asociar la plantilla de los cuatro equipos o crear equipos y sortear integrantes seleccionados. Las asociaciones se guardan juntas en una transacción.
3. Asignar áreas en Participantes. Configurar tiempos máximos y revisar rúbricas en Áreas. Configurar calendario, límite de áreas, tamaño de equipo, pausas y fases en Configuración.
4. Activar concurso. Evaluar → área → fase → colaborador → abrir evaluación → iniciar → detener → completar rúbrica → guardar → confirmar.
5. Consultar Fixture y Ranking. Una aprobación avanza a la siguiente fase. Resolver cada área cuando termine; una igualdad exacta crea una ronda de desempate. El administrador no puede seleccionar arbitrariamente al ganador.
6. Los resultados pueden corregirse desde Historial con motivo obligatorio. Un eliminado puede recibir un reintento desde Participantes, también con motivo. Ambas acciones se auditan.

## Despliegue y migraciones

Instaladas en el proyecto Supabase `nwwnnnjppycdrbeuzhnf`:

- `20260927053023_speed_quality_competition.sql`.
- `20260927053329_competition_foreign_key_indexes.sql`.
- `20260927055506_competition_staff_eligibility.sql`.

Las versiones locales coinciden con el historial remoto. No volver a aplicar manualmente estos archivos al mismo proyecto. En otro entorno, aplicar las migraciones después del esquema y de las funciones de autorización existentes. `scripts/verify-competition-remote.sql` contiene comprobaciones exclusivamente de lectura.

**Pendiente de aplicar y validar:** `20260930000609_competition_registration_and_draw.sql`. Añade inscripción propia, cupos por equipo, mínimo por área, perfiles pendientes y sorteo persistido. El usuario pidió el 30/09/2026 subir el trabajo a GitHub sin ejecutar pruebas. Estos últimos cambios no se probaron ni compilaron y esta migración no se instaló en el proyecto remoto. Los resultados de verificación documentados más abajo corresponden a la versión anterior. Antes de usar los nuevos botones en Supabase hay que aplicar esta migración y validar su comportamiento. Los fixtures locales se adaptaron a los nuevos mínimos, sin ejecutarlos.

La configuración de Firebase Hosting permanece igual. El frontend se compila con `npm run build` y se publica mediante el procedimiento existente: `firebase deploy --only hosting:lc-scheduler`. Esta implementación no publica automáticamente el frontend.

## Verificación reproducible

Pruebas JS, incluidas las existentes que usan módulos VM:

```sh
node --experimental-vm-modules --test src/services/*.test.js src/lib/supabase/*.test.js
npm run build
```

Las pruebas SQL ejecutan PostgreSQL mediante PGlite y crean únicamente identidades ficticias en memoria. No necesitan Docker, credenciales ni acceso a producción. Instalar el ejecutor fuera del proyecto permite mantener intactas sus dependencias:

```sh
npm install --prefix /tmp/competition-test-runtime @electric-sql/pglite@0.3.16
PGLITE_MODULE=/tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-competition-db.mjs
```

Para probar visualmente los componentes reales contra esas RPC en una base local desechable:

```sh
PGLITE_MODULE=/tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/serve-competition-qa.mjs
```

Abrir `http://127.0.0.1:4178/concurso`; una pestaña con `?role=collaborator` usa la identidad ficticia del colaborador. El adaptador de autenticación/transporte y su actualización periódica pertenecen exclusivamente al script de QA, nunca se importan al build. La aplicación real usa Supabase Auth y Realtime. No publicar este servidor de pruebas ni abrirlo fuera de localhost.

Pruebas SQL: permisos por rol y tienda, denegación de escritura directa, límite de áreas, calidad 89/90/100/101, error crítico, tiempo excedido, recuperación del cronómetro, rechazo de segundo inicio, pausa/reanudación, cancelación, idempotencia, total de 14 puntos, corrección y recálculo, empate exacto, desempate fallido y nueva ronda, exclusión de no empatados y ausencia de puntos repetidos en desempates.

Verificación en navegador local: recarga durante cronómetro, segunda pestaña recuperando el mismo intento sin botón de inicio duplicado, bloqueo de navegación con evaluación pendiente, parada y guardado de 96/100 con +1 punto, avance de Clasificación a Fase 2 en fixture, ranking y panel de colaborador sin controles administrativos. La prueba funcional usa RPC PostgreSQL reales en PGlite; no demuestra una sesión Auth/Realtime real de producción. En remoto se verificaron RLS, grants, wrappers invoker, funciones privadas, vistas invoker y publicación Realtime. Una prueba que pretendía usar una identidad administrativa real fue rechazada por revisión automática y no se ejecutó; se sustituyó por verificación remota de solo lectura.

## Límites y decisiones que importan

- El cronómetro mide entre la recepción de INICIAR y DETENER en PostgreSQL. La latencia y variación de red afectan la correspondencia con el instante físico del botón; mostrar centésimas no garantiza precisión física de centésimas. Si se pierde la conexión, el servidor sigue contando. La UI no presenta una parada local como confirmada.
- El cronómetro persiste; las puntuaciones de rúbrica sin confirmar son un borrador de la pantalla y deben volver a introducirse después de recargar.
- La advertencia al cerrar/recargar usa el diálogo nativo que permite el navegador. Los cambios de pantalla dentro del módulo ofrecen volver o cancelar con motivo.
- El fixture es de avance por aprobación en cada área; no se inventan enfrentamientos o cupos eliminatorios que no están definidos en los requisitos.
- Por diseño, tiempos, rúbricas y equipos quedan congelados una vez que existen intentos. Se pueden modificar en borrador y reutilizar el esquema para nuevos concursos, sin cambiar retroactivamente la vara de evaluación.
- Los datos de demostración del servidor QA no se crean en Supabase. La plantilla real requiere revisión de asociaciones y la configuración de tiempos máximos.

Referencias de implementación: [RLS y vistas invoker](https://supabase.com/docs/guides/database/postgres/row-level-security), [Postgres Changes y limpieza de canales](https://supabase.com/docs/guides/realtime/postgres-changes).

Última verificación: 27/09/2026. Build de producción correcto; 13 archivos de pruebas JS aprobados; suite PostgreSQL aprobada. Se verificó y corrigió también la navegación Atrás durante una evaluación. El asesor de seguridad remoto no reportó incidencias de las tablas o RPC nuevas. Conserva el aviso previo de [protección de contraseñas filtradas desactivada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); no se cambió la configuración global de Auth. Se añadieron los índices de claves foráneas identificados para el módulo. La advertencia de tamaño del bundle principal ya existía; el concurso se carga en un chunk separado.
