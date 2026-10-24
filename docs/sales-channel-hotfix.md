# Corrección de canales en análisis de ventas

Publicado el 24 de octubre de 2026 en https://lc-scheduler.web.app.

El análisis fallaba al encontrar canales sin inicializar, por ejemplo SERV. AUTO o RAPPI, al acumular ventas de la hora 21. La corrección inicializa los acumuladores de cada canal y considera las horas y canales presentes tanto en ventas como en transacciones. También admite horas sin datos y cantidades numéricas recibidas como texto.

## Alcance del despliegue

Se preparó una publicación independiente en `tmp/sales-channel-hotfix` a partir de la copia exacta de producción `tmp/production-buk-rrhh`. El único componente modificado respecto de esa copia fue `src/components/SalesAnalysis.jsx`. La versión actual del componente en el repositorio principal ya contiene estas protecciones.

No se aplicaron cambios a Supabase en esta primera publicación. Las mejoras de gestión de administradores se publicaron posteriormente el mismo día, tras conectar la cuenta autorizada; conservaron esta corrección de ventas. El resultado final está documentado en `docs/superadmin-account-management.md`.

## Validación

- Se reprodujo el fallo con el componente anterior mediante `scripts/test-sales-channel-aggregation.mjs`.
- La prueba pasó con el componente principal y con el componente de la publicación: canales adicionales, horas con solo transacciones, datos nulos, cantidades como texto y acumulaciones entre días.
- `scripts/verify-sales-channel-hotfix-ui.mjs` verificó ventas y transacciones en escritorio y móvil con datos simulados, sin errores de JavaScript. Capturas en `output/sales-channel-hotfix/`.
- La compilación y `firebase deploy --only hosting:lc-scheduler --project lc-scheduler --non-interactive` finalizaron correctamente.
- La web respondió HTTP 200 y su archivo principal descargado coincidió por SHA-256 con la compilación verificada. No se probó una sesión real del usuario en producción.

## Identificación de versiones

Versión anterior: `index-BXgB4SB-.js`, SHA-256 `FF6237564221B506C80950B7120B91956EC9D4751AAE184090519E94B9D8274C`.

Versión publicada: `index-jJ6ORD-h.js`, SHA-256 `169984C703C61E59A3A8998FC4C49979997408536F48477C2791AD382A1CEC65`.

El script `scripts/prepare-sales-channel-hotfix.mjs` comprueba la identidad de la versión de partida y prepara el directorio independiente; rechaza sobrescribir un directorio de destino existente.
