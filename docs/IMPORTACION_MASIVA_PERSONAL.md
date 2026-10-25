# Carga masiva de colaboradores desde planilla BUK

El panel de administración incluye **Importar planilla BUK**, junto a Agregar Personal. El archivo se analiza en el navegador y muestra una vista previa antes de guardar. La importación crea perfiles laborales; no crea cuentas de acceso ni cambia las existentes.

La planilla `Planilla_24-10-2026.xls` contiene la hoja Trabajador, con cabecera en la fila 5 y 32 colaboradores de Porongoche. Se usan únicamente Documento de Identidad, Nombre, Primer Apellido, Segundo Apellido, Especialidad/Cargo, Contrato/Modalidad y Área. Las columnas de remuneración, cuentas bancarias, domicilio, teléfono y demás datos se ignoran.

La vista previa y el listado del panel muestran el nombre completo unido. La base conserva Nombre y ambos apellidos para que el formulario de edición existente funcione. Full-Time y Part-Time son modalidades; ENTRENADOR, ASISTENTE, GERENTE y COLABORADOR son cargos. Un ENTRENADOR no es una persona con entrenamiento pendiente. Cuando el cargo no especifica jornada y el contrato no indica parcial, se propone Full-Time y se señala para revisión.

Solo se envían las filas nuevas de la tienda actual. Los DNI existentes, incluso cesados, no se actualizan ni reactivan. Una copia idéntica dentro del archivo solo se considera una vez; las filas contradictorias con el mismo DNI se omiten. Filas con DNI, nombres, área o clasificación inválidos se muestran con su motivo. El límite es de 500 filas y 5 MB por archivo.

El guardado usa `import_staff_planilla`, valida la sesión y la tienda en el servidor, conserva RLS y ejecuta un único lote atómico. Un bloqueo breve serializa la revisión de DNI y las altas del lote. No se añade un índice global de DNI, porque los registros históricos pueden compartir esa identidad. Una repetición de la importación conserva los perfiles existentes.

Los nuevos perfiles quedan sin cuenta de acceso vinculada, con estado pending y marca needs_completion. Fecha de ingreso, carnet y demás datos pueden completarse desde Editar. Para esta fuente, completar fecha de ingreso y fecha del carnet, junto con los campos básicos válidos, retira la marca de datos incompletos. Correo, sexo y nacimiento siguen siendo opcionales. El estado de acceso no cambia por completar estos datos.

## Pruebas antes de publicar

Las pruebas usan un PostgreSQL PGlite aislado, los esquemas/RLS pertinentes del repositorio y la migración real. No crean colaboradores en producción.

```sh
node --test src/services/staffPlanillaImport.test.js src/services/staffProfileSave.test.js
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-staff-planilla-import-db.mjs
PGLITE_MODULE=/tmp/planilla-backend-runtime/node_modules/@electric-sql/pglite/dist/index.js PLAYWRIGHT_MODULE=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs CHROMIUM_PATH=/usr/bin/chromium node scripts/verify-staff-planilla-import-ui.mjs
```

El recorrido de navegador carga el archivo real, verifica 32 altas persistidas con los nombres y DNI esperados, 20 Part-Time, 12 Full-Time, dos entrenadores y dos asistentes. Comprueba recarga, archivo repetido sin duplicados, perfil inactivo sin cambios, área incorrecta, archivo inválido, cancelación y vista móvil. Las pruebas de base verifican permisos por tienda, atomicidad, validación, omisiones, edición posterior y datos adicionales.

Las capturas y resultados quedan en `output/staff-planilla-qa/`, excluido de Git. El archivo de personal y sus datos no se incorporan al repositorio.
