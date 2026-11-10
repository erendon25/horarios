# Recuperación de horarios en producción

## Causa comprobada

Firebase Hosting sirvió `/assets/index-oMzb81Dc.js` el 10 de noviembre de 2026.
Es el mismo archivo del build de `.worktrees/export-study-20261110`, basado en
`main` (`a66e089`). La versión de Hosting es `a7fe98b7699d0a8e`, publicada el
9 de noviembre a las 23:06:27 de Lima.

`main` tenía la base de septiembre (`cde630b`) y las exportaciones de estudios
de los PR #2 y #3. Los cambios de octubre y noviembre estaban en
`codex/competition-registration` (`ace24f6`), sin integrar en `main`.
Publicar el build de `main` reemplazó la aplicación completa con esa base antigua.
El código posterior seguía guardado en Git.

## Integración

La rama `codex/restore-production-scheduling` integra ambos historiales:

- Vista de cobertura predeterminada y edición clásica, borradores, posiciones,
  breaks y candidatos compatibles con disponibilidad.
- Catálogo y reglas BUK, planes semanales y sincronización de descansos part-time.
- Accesos por tienda a estudios y solicitudes, bloqueos por fecha/semana e
  historial de solicitudes propias.
- Proyección de demanda, áreas, horas y exclusión de gerencia del VHL operativo.
- Exportación Excel de disponibilidades de `main`, con paginación y estudios
  nocturnos preservados.

Los conflictos de septiembre se resuelven conservando las implementaciones
posteriores. No se incorporan los archivos temporales `.tmp/` del commit antiguo.
Las pruebas de interfaz de proyecciones y accesos admiten rutas de Windows; la
prueba de cobertura espera la carga asíncrona de entrenadores.

Firebase compila mediante `predeploy` antes de publicar. Vite genera
`/release.json` con commit, rama, fecha y estado de modificaciones del código.
Esto permite identificar la versión y evita publicar por accidente un build
sobrante de otra rama. Sigue siendo necesario integrar los cambios en `main`
antes de usarla para desplegar.

## Validación

- Build de Vite correcto. Persiste la advertencia previa de chunks grandes.
- 396 pruebas Node aprobadas; 3 omitidas por sus condiciones de entorno.
- 15 comprobaciones de permisos/RPC/RLS con PostgreSQL PGlite local aprobadas.
- 6 escenarios de cobertura en navegador aprobados, incluidos móvil y guardado.
- 8 escenarios de accesos a horarios en navegador aprobados.
- 4 escenarios de horas laborales y proyección en navegador aprobados.

Las pruebas usan datos ficticios y transportes aislados. No modifican datos de
producción. La consulta remota de funciones de Supabase no estuvo disponible
mediante el conector en esta sesión; no se aplicaron migraciones ni cambios de
configuración del backend.

La versión anterior de Hosting se conserva como referencia para una reversión.
La publicación de recuperación debe comprobarse comparando `/release.json` y
el módulo de `/index.html` con el build revisado.
