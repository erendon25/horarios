# Migración Firebase → Supabase

Firebase se usa únicamente como fuente de lectura. La aplicación seguirá escribiendo en Firebase hasta el corte final.

## Archivos requeridos

Crear localmente estas carpetas (están ignoradas por Git):

```text
migration/
  secrets/
    firebase-service.json
    firebase-auth-hash-config.txt
  exports/
  transformed/
```

`firebase-service.json` se descarga desde Firebase Console → Configuración del proyecto → Cuentas de servicio → Firebase Admin SDK → Generar nueva clave privada.

`firebase-auth-hash-config.txt` debe contener los parámetros mostrados en Firebase Console → Authentication → Users → menú de tres puntos → Password hash parameters:

```text
hash_config {
  algorithm: SCRYPT,
  base64_signer_key: ...
  base64_salt_separator: ...
  rounds: ...
  mem_cost: ...
}
```

No pegar secretos en el código, commits, capturas ni conversaciones.

## Orden de la primera copia

1. Inventario y conteo de Firebase Auth y Firestore.
2. Exportación de usuarios y hashes.
3. Exportación de colecciones y subcolecciones.
4. Transformación y validación en archivos temporales.
5. Importación de tiendas.
6. Importación de Auth, incluyendo el superadministrador.
7. Importación de perfiles y relaciones.
8. Importación de horarios, RR. HH., capacitación, ventas y proyección.
9. Comparación de conteos y muestras.

## Comandos reproducibles

Todos estos comandos son de lectura y transformación local; no modifican Firebase:

```text
node migration/export-firebase.mjs
node migration/inspect-export-shapes.mjs
node migration/analyze-relations.mjs
node migration/transform-firebase.mjs
node migration/validate-transformation.mjs
node --use-system-ca migration/import-auth-to-supabase.mjs
node --use-system-ca migration/import-data-to-supabase.mjs
```

Los resultados privados quedan en `migration/exports/` y `migration/transformed/`, ambos ignorados por Git.

`transform-firebase.mjs` genera UUID determinísticos para tiendas, usuarios de Auth y colaboradores. También reconstruye perfiles históricos inactivos cuando un horario, cese o feriado apunta a un perfil eliminado. Esos perfiles se marcan con `needs_completion = true` para conciliarlos antes del corte.

Los documentos duplicados de una misma persona y semana se conservan en `transformation-report.json`; para la importación operativa se elige de forma determinística el documento más completo.

La configuración Firebase `config/schedule_projection` es una plantilla por día de semana, no una proyección fechada. Se transforma a `sales_projection_templates`; las tablas `sales_projections`, `sales_projection_hours` y `staffing_projection_hours` quedan reservadas para proyecciones futuras con `week_start` real.

## Reglas de seguridad

- La clave privada se revoca al terminar la migración.
- Los archivos de exportación se eliminan después de la validación final.
- La clave `service_role` de Supabase nunca se incluye en el frontend.
- La primera copia no elimina ni modifica documentos en Firebase.

## Estado de la primera copia

- Auth se consolidó por correo normalizado: 167 UIDs Firebase se convirtieron en 166 identidades Supabase porque dos UIDs compartían el mismo correo.
- Las relaciones de ambos UIDs apuntan al UUID Supabase canónico y los UIDs originales permanecen en `legacy_data`.
- Las funciones temporales `firebase-auth-import` y `firebase-data-import` se despliegan cerradas (`IMPORT_ENABLED = false`) y responden HTTP 410.
- No se enviaron invitaciones, correos ni restablecimientos de contraseña durante la carga.
- Antes del corte final se debe ejecutar una exportación incremental y repetir la conciliación.
