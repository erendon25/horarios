# Prueba de foto de perfil

Prueba ejecutada el 11 de octubre de 2026 en `codex/competition-registration`.

## Reproducción

Con Playwright, Chromium y PGlite disponibles:

```sh
npm run test:profile-photo:e2e
```

Si las dependencias están fuera del proyecto, indicar `PLAYWRIGHT_MODULE`,
`CHROMIUM_PATH` y `PGLITE_MODULE` con sus rutas antes del comando.
El ejecutor inicia y cierra un servidor aislado con datos nuevos.

## Resultado

- JPG, PNG y WebP: selección, vista previa, recorte a 512×512, conversión a JPEG, guardado y persistencia al recargar.
- Reemplazo de foto sin duplicar el registro ni cambiar la ruta propia.
- Cancelación sin subir archivos.
- Rechazo de SVG, PDF, archivos vacíos, imágenes corruptas y archivos de más de 10 MB.
- Subida interrumpida: conserva los datos anteriores y permite reintentar.
- Respuesta perdida después de confirmar el guardado: conserva el archivo y se recupera al recargar.
- Eliminación: restaura la imagen predeterminada y persiste al recargar.
- Sin errores de JavaScript en el navegador; vista móvil de 390×844 verificada.

Capturas y resultado detallado en `output/profile-photo-qa/` (no versionado).
También pasaron las seis pruebas unitarias de `src/services/profilePhoto.test.js`
y las pruebas de permisos de `scripts/test-profile-photos.mjs`.

## Alcance

Se usa la interfaz de la rama, archivos reales y los RPC y políticas SQL en
PostgreSQL aislado mediante PGlite. El transporte de Auth y Storage se adapta
localmente; esta prueba no valida el servicio de Storage de producción.
No modifica cuentas ni fotos reales.

La comprobación inicial encontró pendientes la tabla `staff_profile_photos`,
el RPC `set_own_profile_photo` y el bucket `profile-photos`.
Se habilitaron el 11/10/2026 mediante la migración
`20261011130351_staff_profile_photos.sql`. Se verificaron RLS y permisos contra
la base real y el rechazo de subidas y llamadas de guardado sin sesión a través
de la API de producción. La prueba de navegador se repitió sin instalar la
migración independiente de reconocimientos, con todos los casos aprobados.

El frontend se compiló y se publicó primero en el canal Firebase `fotos-perfil`.
Se comprobaron por HTTPS el índice y los 24 archivos JS/CSS, incluyendo los de
la versión anterior para las pestañas abiertas. La publicación en producción
promueve esa misma versión. Copia previa para restauración:
`lc-scheduler:antes-fotos-perfil`.

No se realizó una subida autenticada contra Storage real usando una cuenta
de colaborador: esa parte del recorrido conserva el alcance local descrito
arriba. Se puede comprobar desde **Información del Perfil → Foto de perfil**
con una sesión propia.
