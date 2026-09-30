# Continuar el trabajo del concurso

Estado guardado el 30/09/2026 por petición del usuario. Los últimos cambios de inscripción y sorteo se entregan sin ejecución de pruebas ni compilación.

## Preparar la otra PC

```bash
git clone https://github.com/erendon25/horarios.git
cd horarios
git switch codex/competition-registration
npm ci
cp .env.example .env.local
npm run dev -- --host 127.0.0.1
```

Si el repositorio ya está clonado, usar `git fetch origin` y `git switch --track origin/codex/competition-registration` (o cambiar a la rama local si ya existe). `.env.example` contiene la URL y la clave pública del frontend. No copiar credenciales administrativas al código ni al navegador.

## Base de datos

Proyecto Supabase existente: `nwwnnnjppycdrbeuzhnf`.

Las migraciones del concurso de versiones `20260927053023`, `20260927053329` y `20260927055506` ya se instalaron en ese proyecto. No reaplicarlas.

La migración **`20260930000609_competition_registration_and_draw.sql` está pendiente de aplicar**. Incluye:

- Registro y retiro por el propio colaborador, limitado a su identidad autenticada y a su equipo.
- Máximo 2 integrantes de cada equipo por área; máximo de áreas por persona conservado.
- Mínimo 2 inscritos elegibles por área antes de empezar.
- Perfiles pendientes de completar disponibles para asociar, con bloqueo de perfiles inactivos y cesados.
- Sorteo automático al activar, con orden y cruces persistidos y auditados.

Primero revisar y validar esta migración en un entorno local; después instalarla con el flujo de Supabase existente. Las migraciones de feriados también estaban en el trabajo local y se guardaron para conservar los imports y el estado del panel. Su versión local `20260922044944` difiere de la versión registrada remotamente `20260922045935`; reconciliar ese historial antes de un `supabase db push` general. No empujar todas las migraciones a ciegas.

## Validación pendiente

Revisar el selector con perfiles `active`, `pending`, `inactive` y con cese efectivo. Validar inscripción propia, doble clic, cupos simultáneos, rechazo de identidad ajena, mínimo por área, retiro en borrador y cierre de inscripciones. Comprobar que el sorteo se conserva al recargar, que con 3/5 inscritos no crea grupos de una sola persona y que el líder ve las áreas de sus integrantes.

Los scripts existentes están en `scripts/test-competition-db.mjs`, `scripts/competition-test-db.mjs` y `scripts/serve-competition-qa.mjs`. Sus fixtures se adaptaron al mínimo y al cupo por equipo, pero no se ejecutaron en esta entrega. Ver `docs/CONCURSO.md` para los comandos. El frontend nuevo no se publicó en Firebase Hosting.
