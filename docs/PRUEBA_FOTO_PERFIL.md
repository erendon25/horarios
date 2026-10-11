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

La comprobación de producción encontró pendientes la tabla
`staff_profile_photos`, el RPC `set_own_profile_photo` y el bucket
`profile-photos`. La funcionalidad requiere aplicar sus migraciones y publicar
el frontend antes de comprobar una subida contra los servicios reales.
