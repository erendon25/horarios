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

### Publicación al equipo

Cada concurso empieza oculto, independientemente de su estado. Los administradores de la tienda y los superadmins pueden prepararlo desde **Concurso → Configuración**. **Publicar al equipo** habilita **Mi concurso** para colaboradores y trainers de esa tienda; **Ocultar al equipo** revoca esa visibilidad sin borrar inscripciones, evaluaciones ni puntos. El panel del colaborador comprueba la publicación al abrirse, recuperar el foco y cada 15 segundos.

La publicación es independiente de la activación: se puede publicar un borrador para abrir inscripciones, y activar después para cerrarlas y sortear el fixture. Activar un concurso oculto no lo publica. La migración de publicación deja también los concursos existentes ocultos hasta una publicación explícita.

La base de datos aplica la restricción a la lista de concursos, sus tablas y sus rankings mediante RLS. Los comandos de inscripción y retiro también rechazan concursos ocultos aunque se conozca su UUID. Solo un administrador de la tienda o superadmin puede cambiar la publicación; cada cambio se audita.

Prueba aislada de acceso y publicación: `PGLITE_MODULE=<ruta a @electric-sql/pglite/dist/index.js> node scripts/test-competition-publication.mjs`.

### Participación y evaluación

La plantilla inicial se genera con los trainers vigentes de la tienda: tres trainers producen tres equipos, cada uno con un líder distinto y sin integrantes todavía. Los nombres y asociaciones se revisan antes de guardar; luego se añaden o sortean integrantes sin límite de integrantes por equipo. No se usa una cantidad fija de cuatro equipos ni nombres de entrenadores predefinidos.

Solo un perfil disponible cuyo puesto actual en RR. HH. sea `ENTRENADOR` puede liderar un equipo. El rol de su cuenta no sustituye ese puesto. La vista `competition_current_teams` comprueba el puesto, la actividad laboral y el cese en cada consulta: al dejar de cumplirlos, el equipo se muestra sin trainer vigente y la persona sale del ranking de trainers. Se conserva la asociación histórica junto con integrantes y resultados; no se redistribuyen integrantes automáticamente. El selector de líderes y los comandos de creación/edición y plantilla aplican la misma restricción. Prueba: `PGLITE_MODULE=<ruta a @electric-sql/pglite/dist/index.js> node scripts/test-competition-current-trainers.mjs`.

Los tiempos máximos NO se deducen de los ejemplos: deben configurarse antes de activar. Calidad mínima 90; fases 1/2/3/5; bonus campeón 3; máximo 2 áreas por persona y equipos sin límite de integrantes. Los nombres sugeridos requieren revisión y asociación por UUID.

El tiempo aporta 15 puntos en las siete áreas. Landing, Landing Crazy, Vestido,
Sheetout y Masa usan procedimiento 20, cantidades 20, presentación 15, técnica 15,
orden/limpieza 10, seguridad/manipulación 5 y tiempo 15: total 100. Drive Thru y
Servicio conservan sus distribuciones, que ya incluyen tiempo/rapidez 15.
El servidor asigna 15 si la duración es menor o igual al máximo del área y 0
si lo supera; no acepta que el evaluador altere ese resultado. Superar el máximo
sigue impidiendo aprobar. El tiempo objetivo opcional no cambia esta puntuación.
La migración `20261011070918_score_time_in_all_competition_areas.sql` actualiza
las plantillas iniciales de borradores sin evaluaciones y la creación de nuevos
concursos. Las rúbricas personalizadas y los concursos con historial se conservan.

La inscripción personal está en **Inscripción**, con botón por área y retiro disponible mientras el concurso esté en borrador. Cada colaborador elige hasta 2 áreas entre Landing, Landing Crazy, Vestido, Sheetout, Masa, Drive Thru y Servicio. No hay cupo por equipo en cada área. En Participantes, el administrador consulta las elecciones sin formularios de asignación o retiro manual. El administrador debe formar los equipos primero. Para activar, cada área que tenga inscripciones necesita al menos 2 inscritos elegibles; las áreas vacías no compiten. Se valida nuevamente ese mínimo antes de iniciar la primera evaluación del área. Una vez que el área ya tuvo resultados, la eliminación deportiva puede dejar un único finalista sin incumplir el mínimo inicial.

Solo pueden asociarse perfiles laboralmente vigentes (`active` o `pending`), sin cese efectivo ni entrenamiento finalizado. `pending` indica vinculación o registro de cuenta pendiente, no inactividad laboral; puede integrar o liderar equipos si cumple las condiciones de empleo y puesto. El selector y el sorteo ocultan inactivos, cesados y entrenamientos finalizados. La autorización de cuentas sigue requiriendo una sesión y un perfil de usuario activo; no se activa ninguna cuenta ni se modifica RR. HH. automáticamente. El último día de entrenamiento permanece válido, calculado en `America/Lima`; al día siguiente el perfil deja de ser elegible. El servidor valida estas reglas en asignaciones, plantillas y sorteos. Las cuentas que se inscriben requieren una sesión activa y un vínculo válido. No se activan ni modifican perfiles de RR. HH. automáticamente. Los líderes ven en **Mi concurso** las áreas y fases de todos los integrantes de su equipo.

Al activar se guarda un sorteo por área con turnos y cruces, alternando equipos cuando es posible. Los grupos son de 2; con un total impar el último grupo tiene 3 para evitar una persona sola. El sorteo persiste al recargar y se audita. Los cruces organizan las evaluaciones: el avance sigue dependiendo del umbral de calidad y tiempo, y la comparación entre finalistas decide el campeón. No existe eliminación directa por ganar un cruce. Volver a borrador antes de cualquier intento permite editar inscripciones y regenerar el sorteo al activar de nuevo.

Configuración, equipos y rúbricas se editan en borrador. Para proteger el historial, no se vuelve a borrador después de crear evaluaciones. Los límites y criterios de cada evaluación se copian al crearla. Los resultados guardados son inmutables; la corrección explícita de un resultado invalida ese intento y los posteriores del área/persona, revoca el campeón del área, recalcula puntos y exige motivo. La auditoría conserva los valores anteriores. Los intentos cancelados no otorgan puntos.

Aprobar avanza automáticamente. Fallar elimina; el administrador puede reabrir la participación con motivo para otro intento de la misma fase. Solo una evaluación aprobada por persona/área/fase otorga puntos. La declaración de campeón exige que todas las inscripciones del área terminen y no existan evaluaciones pendientes. Se compara calidad y luego tiempo entre finalistas aprobados. El empate genera una ronda de desempate exclusivamente entre empatados; sus evaluaciones no repiten puntos. Si todos fallan, se requiere otra ronda. El campeón se declara explícitamente cuando hay evidencia suficiente.

Una fecha de cese futura permite inscribir y evaluar al colaborador hasta el final de ese día, calculado en `America/Lima`. Se muestra la fecha en las opciones administrativas. A partir del día siguiente, o si el perfil pasa a inactivo, su participación figura como «Fuera de competencia»: no puede abrir, iniciar, reanudar ni guardar evaluaciones, ni recibir un título de campeón aún no declarado. Puede detenerse y cancelarse con motivo un intento que quedó abierto. Para resolver un área se omiten sus intentos pendientes; el administrador debe cancelar esos intentos para dejar el historial limpio. Los puntos oficiales anteriores, la pertenencia al equipo y los títulos ya declarados se conservan. El cese no crea vacantes ni redistribuye automáticamente integrantes, pues eso alteraría el sorteo y la puntuación ya conocidos. Si RR. HH. quita la fecha de cese y el perfil sigue activo, vuelve a ser elegible en el mismo grupo y sus inscripciones previas, sin asignación automática a otro grupo. Puede volver a evaluarse solo si el área y concurso siguen abiertos. Si una evaluación quedó abierta durante el cese, debe cancelarse antes de retomarla.

## Uso

Los líderes de equipo solo hacen seguimiento de sus colaboradores: su vista contiene **Mi concurso**, **Fixture** y **Ranking**, sin **Inscripción**. El servidor también rechaza `register` para un perfil asignado como líder del concurso, aunque envíe otro ID en el payload o tenga un vínculo histórico como integrante. La migración `20261011131719_competition_leaders_followup_only.sql` refuerza esta regla sin borrar resultados ni cambiar equipos o puntos. Está aplicada en producción; el concurso de Porongoche no tenía inscripciones de líderes que retirar.

El ranking de líderes usa el promedio de puntos por integrante: total del equipo dividido entre todos sus integrantes, incluidos quienes tienen cero puntos o están fuera de competencia. La plantilla no se puede editar mientras el concurso esté activo ni volver a borrador una vez registrados intentos; los ceses conservan la pertenencia al equipo. Un equipo sin integrantes muestra cero. El promedio se presenta con hasta dos decimales y se ordena sin redondear; los promedios iguales comparten posición. Los puntos individuales y el ranking de equipos siguen usando sus totales. Este cálculo se realiza en la vista del servidor incorporada por la migración de promedio por líder.

Para igualar oportunidades, cada integrante debe tener acceso al mismo número de áreas y las áreas deben ofrecer los mismos puntos de fase y bono. El promedio corrige la diferencia de tamaño de plantilla; no corrige diferencias en oportunidades de inscripción.

1. Entrar en **CONCURSO** desde el panel administrativo, o **MI CONCURSO** desde el panel personal. Ruta: `/concurso`.
2. Crear concurso y seleccionar su tienda. En Equipos, preparar un equipo por cada trainer vigente o crear equipos y sortear integrantes seleccionados. Las asociaciones se guardan juntas en una transacción.
3. Publicar el concurso al equipo para que cada colaborador elija hasta 2 áreas desde Inscripción. Consultar las elecciones en Participantes. Configurar tiempos máximos y rúbricas en Áreas, y calendario, pausas y fases en Configuración.
4. Activar concurso. Evaluar → área → fase → colaborador → abrir evaluación → iniciar → detener → completar rúbrica → guardar → confirmar.
5. Consultar Fixture y Ranking. Una aprobación avanza a la siguiente fase. Resolver cada área cuando termine; una igualdad exacta crea una ronda de desempate. El administrador no puede seleccionar arbitrariamente al ganador.
6. Los resultados pueden corregirse desde Historial con motivo obligatorio. Un eliminado puede recibir un reintento desde Participantes, también con motivo. Ambas acciones se auditan.

## Despliegue y migraciones

Instaladas en el proyecto Supabase `nwwnnnjppycdrbeuzhnf`:

- `20260927053023_speed_quality_competition.sql`.
- `20260927053329_competition_foreign_key_indexes.sql`.
- `20260927055506_competition_staff_eligibility.sql`.

Las versiones locales coinciden con el historial remoto. No volver a aplicar manualmente estos archivos al mismo proyecto. En otro entorno, aplicar las migraciones después del esquema y de las funciones de autorización existentes. `scripts/verify-competition-remote.sql` contiene comprobaciones exclusivamente de lectura.

Actualizaciones del 30/09/2026: inscripción y sorteo (`20260930000609`), publicación (`20260930203005`), trainers vigentes (`20260930210634`), colaboradores activos (`20260930212759`) y equipos sin límite con promedio por líder (`20260930213448`). Las suites de PostgreSQL cubren estas reglas, autorización, publicación, puntuación e historial.

La configuración de Firebase Hosting permanece igual. El frontend se compila con `npm run build` y se publica mediante el procedimiento existente: `firebase deploy --only hosting:lc-scheduler`. Esta implementación no publica automáticamente el frontend.

## Verificación reproducible

Verificación del 11/10/2026: publicación desde el panel, inscripción, fixture, resultados y ocultación aprobados en navegador con datos aislados. Véase [Prueba del recorrido del colaborador](PRUEBA_CONCURSO_COLABORADOR.md) para resultados, capturas y el comando `npm run test:competition:e2e`.

### Fotos de perfil

El panel del colaborador permite elegir, previsualizar, guardar, cambiar y eliminar su foto desde **Información del Perfil → Foto de perfil**. Acepta JPG, PNG y WebP de hasta 10 MB; la aplicación recorta al centro y prepara una imagen JPEG cuadrada de 512 px. El fixture muestra la foto en cruces, fases y campeón. Si no hay foto o no se puede cargar, muestra una silueta de persona predeterminada, incorporada en el componente y sin solicitudes adicionales de red.

La migración `20261011130351_staff_profile_photos.sql` crea el bucket privado `profile-photos` (2 MB por archivo), la tabla `staff_profile_photos` y la RPC `set_own_profile_photo`. La RPC obtiene el colaborador de la sesión; el cliente no elige qué perfil modificar. Las políticas permiten escritura únicamente en `<auth.uid()>/profile.jpg`. Las lecturas se permiten al propietario, responsables autorizados o participantes de la misma tienda cuando el perfil pertenece a un concurso visible. Los enlaces firmados duran una hora; enlaces ya emitidos conservan su vigencia hasta expirar. Los reemplazos mantienen el archivo y actualizan la versión del enlace para evitar fotos en caché o romper otras pestañas. Una incidencia de Storage no bloquea la lectura del concurso.

**Habilitado el 11/10/2026:** la migración está instalada en el proyecto `nwwnnnjppycdrbeuzhnf`. Se verificaron el bucket privado, RLS, permisos de lectura y guardado, y la denegación de escrituras directas o anónimas. El frontend permite desplegar fotos antes de la migración independiente de reconocimientos. Las pruebas de carga con archivos reales usan PostgreSQL/PGlite y un transporte Storage aislado; no se cambiaron fotos de colaboradores reales.

Verificar después de aplicar la migración:

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'profile-photos';
select relrowsecurity from pg_class
where oid = 'public.staff_profile_photos'::regclass;
select has_table_privilege('authenticated', 'public.staff_profile_photos', 'SELECT') as can_read,
       has_table_privilege('authenticated', 'public.staff_profile_photos', 'INSERT,UPDATE,DELETE') as direct_writes;
select policyname, cmd from pg_policies
where (schemaname = 'public' and tablename = 'staff_profile_photos')
   or (schemaname = 'storage' and tablename = 'objects' and policyname like 'profile_photos_%');
```

Prueba de permisos y RPC: `node scripts/test-profile-photos.mjs` con `PGLITE_MODULE`. Pruebas de validación y fallos de red: `node --test src/services/profilePhoto.test.js`. E2E: `npm run test:competition:e2e`. Capturas de la foto: `output/collaborator-e2e/11-panel-foto.png` y `12-fixture-foto.png`.

Pruebas JS, incluidas las existentes que usan módulos VM:

```sh
node --experimental-vm-modules --test src/services/*.test.js src/lib/supabase/*.test.js
npm run build
```

Las pruebas SQL ejecutan PostgreSQL mediante PGlite y crean únicamente identidades ficticias en memoria. No necesitan Docker, credenciales ni acceso a producción. Instalar el ejecutor fuera del proyecto permite mantener intactas sus dependencias:

```sh
npm install --prefix /tmp/competition-test-runtime @electric-sql/pglite@0.3.16
PGLITE_MODULE=/tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-competition-db.mjs
PGLITE_MODULE=/tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-competition-all-area-time.mjs
```

Para probar visualmente los componentes reales contra esas RPC en una base local desechable:

```sh
PGLITE_MODULE=/tmp/competition-test-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/serve-competition-qa.mjs
```

Abrir `http://127.0.0.1:4178/concurso`; una pestaña con `?role=collaborator` usa la identidad ficticia del colaborador. El adaptador de autenticación/transporte y su actualización periódica pertenecen exclusivamente al script de QA, nunca se importan al build. La aplicación real usa Supabase Auth y Realtime. No publicar este servidor de pruebas ni abrirlo fuera de localhost.

Pruebas SQL: permisos por rol y tienda, denegación de escritura directa, límite de áreas, calidad 89/90/100/101, error crítico, tiempo excedido, recuperación del cronómetro, rechazo de segundo inicio, pausa/reanudación, cancelación, idempotencia, total de 14 puntos, corrección y recálculo, empate exacto, desempate fallido y nueva ronda, exclusión de no empatados y ausencia de puntos repetidos en desempates.

Verificación en navegador local: recarga durante cronómetro, segunda pestaña recuperando el mismo intento sin botón de inicio duplicado, bloqueo de navegación con evaluación pendiente, parada y guardado de 96/100 con +1 punto, avance de Clasificación a Fase 2 en fixture, ranking y panel de colaborador sin controles administrativos. La prueba funcional usa RPC PostgreSQL reales en PGlite; no demuestra una sesión Auth/Realtime real de producción. En remoto se verificaron RLS, grants, wrappers invoker, funciones privadas, vistas invoker y publicación Realtime. Una prueba que pretendía usar una identidad administrativa real fue rechazada por revisión automática y no se ejecutó; se sustituyó por verificación remota de solo lectura.

## Laureles y certificación automática

La migración `20261011063222_competition_profile_recognition.sql` registra reconocimientos derivados de los resultados oficiales. Al guardar una evaluación aprobada que permite avanzar (incluida la clasificación), el colaborador obtiene certificación al **100% en esa estación**. No basta con inscribirse, iniciar el cronómetro o tener una evaluación pendiente. Un rechazo, error crítico o tiempo excedido no certifica.

El sistema de evaluación distingue estaciones dentro de Servicio/Producción; no certifica automáticamente las demás estaciones del grupo. La correspondencia con las siete áreas del concurso es:

| Área del concurso | Estación de capacitación |
| --- | --- |
| Landing / Landing Crazy | LANDING |
| Vestido | VESTIDO |
| Sheetout | SHEETOUT |
| Masa | PREPARACION |
| Drive Thru | TRAFICO |
| Servicio | SERVICIO |

Capacitación y el panel personal combinan la certificación del concurso con las habilidades normales. Las notas y evaluaciones firmadas originales se conservan: el concurso no inventa firmas ni modifica sus resultados. La implementación de Next.js también reconoce estas estaciones en su módulo de capacitación.

Al **declarar campeón del área**, aparecen laureles dorados alrededor de su foto (o de la silueta predeterminada si no tiene foto) en el fixture, los cruces y el perfil. El perfil indica las áreas ganadas; el fixture muestra laureles únicamente en el área correspondiente. Llegar a la final certifica, pero no otorga laureles hasta declarar el campeón.

Corregir una final retira los laureles; las aprobaciones anteriores válidas mantienen la certificación. Si se invalidan todas las aprobaciones oficiales de esa estación, se retira únicamente la certificación procedente del concurso y vuelven a verse las notas y habilidades independientes. Una aprobación válida de otro concurso también conserva el 100%. La migración incluye los avances y campeones ya existentes y protege el campo derivado contra valores inventados por clientes.

Validación: `scripts/test-competition-recognition.mjs` ejecuta la migración y las RPC reales en PostgreSQL aislado. `scripts/verify-competition-evaluation-ui.mjs` comprueba capacitación al 100%, foto real con laureles en fixture/perfil móvil, ausencia de laureles en otras áreas y retirada tras una corrección.

**Pendiente en producción:** instalar `20261011063222_competition_profile_recognition.sql` si se habilitan las certificaciones y los reconocimientos del perfil. La migración de fotos `20261011130351_staff_profile_photos.sql` ya está instalada y funciona de manera independiente. Las pruebas de reconocimientos son locales y no modifican concursos reales.

## Límites y decisiones que importan

- El cronómetro mide entre la recepción de INICIAR y DETENER en PostgreSQL. La latencia y variación de red afectan la correspondencia con el instante físico del botón; mostrar centésimas no garantiza precisión física de centésimas. Si se pierde la conexión, el servidor sigue contando. La UI no presenta una parada local como confirmada.
- El cronómetro persiste; las puntuaciones de rúbrica sin confirmar son un borrador de la pantalla y deben volver a introducirse después de recargar.
- La advertencia al cerrar/recargar usa el diálogo nativo que permite el navegador. Los cambios de pantalla dentro del módulo ofrecen volver o cancelar con motivo.
- El fixture es de avance por aprobación en cada área; no se inventan enfrentamientos o cupos eliminatorios que no están definidos en los requisitos.
- Por diseño, tiempos, rúbricas y equipos quedan congelados una vez que existen intentos. Se pueden modificar en borrador y reutilizar el esquema para nuevos concursos, sin cambiar retroactivamente la vara de evaluación.
- Los datos de demostración del servidor QA no se crean en Supabase. La plantilla real requiere revisión de asociaciones y la configuración de tiempos máximos.

Referencias de implementación: [RLS y vistas invoker](https://supabase.com/docs/guides/database/postgres/row-level-security), [Postgres Changes y limpieza de canales](https://supabase.com/docs/guides/realtime/postgres-changes).

Última verificación: 27/09/2026. Build de producción correcto; 13 archivos de pruebas JS aprobados; suite PostgreSQL aprobada. Se verificó y corrigió también la navegación Atrás durante una evaluación. El asesor de seguridad remoto no reportó incidencias de las tablas o RPC nuevas. Conserva el aviso previo de [protección de contraseñas filtradas desactivada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); no se cambió la configuración global de Auth. Se añadieron los índices de claves foráneas identificados para el módulo. La advertencia de tamaño del bundle principal ya existía; el concurso se carga en un chunk separado.

### Puntos de líderes y tamaño de equipos

Los equipos pueden tener distinta cantidad de colaboradores. No hay capacidad máxima por trainer en asignaciones, plantillas ni sorteos; el sorteo reparte la selección de forma equilibrada. No hay cupo fijo de integrantes del mismo equipo por área. El límite de áreas por persona y el mínimo de inscritos elegibles por área se mantienen. `team_size` se conserva como campo histórico de compatibilidad, sin limitar la formación de equipos.

Los puntos del líder son el total de puntos oficiales del equipo dividido entre todos sus colaboradores asignados, incluidos quienes tienen cero puntos. El líder no forma parte del denominador. Se conservan los integrantes y puntos históricos tras un cese; no se excluyen del denominador para evitar que sus puntos eleven artificialmente el promedio. Un equipo vacío tiene cero puntos. El ranking se ordena por el promedio sin redondear y la pantalla muestra hasta dos decimales. El ranking de equipos conserva su total y el individual conserva los puntos de cada colaborador. Dashboard, Ranking de trainers y Mi concurso del líder muestran el mismo promedio calculado en el servidor.

Corrección del 30/09/2026 (`20260930214519`): la elegibilidad distingue registro pendiente de cuenta (`pending`) y vigencia laboral, en línea con RR. HH.; mantiene restricciones de inactividad, fechas, tienda y puesto ENTRENADOR.

Elección de áreas (`20260930220620`): seis áreas predeterminadas y límite fijo de dos; Sheetout sin inscripciones queda inactivo conservando sus datos. La pantalla de Participantes permite consultar inscripciones y autorizar reintentos deportivos; no asigna ni retira elecciones. El retiro personal y la sustitución de áreas permanecen disponibles en borrador. Prueba: `node scripts/test-competition-self-selected-areas.mjs` con PGlite.

Sheetout (`20260930221302`) vuelve a estar disponible: siete áreas predeterminadas, incluida su rúbrica de 100 puntos. Se reactiva o crea en concursos en borrador y se incluye en concursos nuevos. Se mantiene el máximo de dos elecciones propias y la publicación independiente.

### Verificación E2E de evaluación

El 30/09/2026 pasó `scripts/verify-competition-evaluation-ui.mjs`: 10 comprobaciones de navegador sobre componentes reales y comandos PostgreSQL de PGlite, con autenticación, transporte y actualización aislados para pruebas. Cubre elección de dos áreas, activación, recuperación del cronómetro, pausa, rúbrica, 90/89, error crítico, tiempo excedido, reinicio, cuatro fases, campeón, promedio del líder y correcciones con auditoría. No comprueba Auth/Realtime reales de Supabase ni la red de Firebase. La suite `scripts/test-competition-db.mjs` también pasó.

Para repetir, iniciar `COMPETITION_QA_MODE=evaluation COMPETITION_QA_PORT=4189 node scripts/serve-competition-qa.mjs` y, en otra terminal, ejecutar `COMPETITION_QA_PORT=4189 node scripts/verify-competition-evaluation-ui.mjs`. Usar `PGLITE_MODULE`, `PLAYWRIGHT_MODULE` y `CHROMIUM_PATH` si las dependencias están fuera de node_modules. Cada repetición necesita un servidor de prueba nuevo para comenzar con datos limpios. Informe, capturas y traza se guardan en `output/evaluation-e2e/`, excluido de Git.

## Puntuación por comprobaciones

Los concursos nuevos y en borrador contienen una guía editable por criterio en Áreas → Rúbrica. Cada acción tiene un peso positivo; todas las acciones deben sumar el máximo del criterio. Evaluar exige Cumple/No cumple y calcula el total en el servidor. Tiempo/Rapidez usan el cronómetro del servidor. Historial muestra la guía copiada al abrir la evaluación y las decisiones guardadas. Los concursos activos anteriores y sus evaluaciones conservan el sistema manual histórico.

Validación: `scripts/test-competition-observable-rubrics.mjs` comprueba cálculo, pesos, decisiones, tiempo automático, roles y conservación histórica. `scripts/test-competition-db.mjs` mantiene cobertura de las rúbricas manuales históricas. `scripts/verify-competition-evaluation-ui.mjs` verifica el flujo de evaluación con React y PostgreSQL aislado.
