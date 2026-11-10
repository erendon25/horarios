# Flujo del proyecto

- `main` es la única fuente de producción. Todo cambio terminado debe quedar
  confirmado y subido a `main` antes de publicarse. No publicar ramas de trabajo
  ni compilaciones sueltas que no correspondan al código de `main`.
- Trabajar desde `main` actualizado. Si hay cambios locales del usuario, conservarlos;
  se puede usar una copia aislada basada en `origin/main` para preparar el trabajo.
  Integrar el resultado en `main` antes del despliegue autorizado.
- Publicar con `npm run deploy:production`. Los hooks comprueban rama, cambios sin
  confirmar, sincronización con GitHub, inclusión del commit ya publicado, pruebas
  de regresión y coincidencia del build. No saltarse esos controles ni usar una
  promoción de Hosting para eludirlos.
- No reemplazar archivos actuales por copias antiguas ni publicar modificaciones
  de bundles que no estén representadas en el código fuente confirmado.
- Revisar `docs/AUDITORIA_COBERTURA_PUBLICADA_2026_11_10.md` al recuperar funciones
  históricas. Las publicaciones posteriores al código inicialmente recuperado
  contienen diferencias documentadas; no dar esa recuperación por completada
  únicamente porque el despliegue o las pruebas actuales terminen correctamente.
