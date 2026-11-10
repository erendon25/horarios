# LC Scheduler

Aplicación de horarios y gestión operativa desplegada en Firebase Hosting y conectada a Supabase.

## Requisitos

- Node.js 20 o superior
- npm
- Git
- Firebase CLI (`npm install -g firebase-tools`)

## Descargar el proyecto

```bash
git clone https://github.com/erendon25/horarios.git
cd horarios
npm install
```

Si ya tienes el repositorio:

```bash
git checkout main
git pull origin main
npm install
```

## Configurar Supabase

El archivo `.env` no se guarda en Git por seguridad y debe existir antes de compilar.

En Linux/macOS:

```bash
cp .env.example .env
```

En Windows CMD:

```bat
copy .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Verifica que `.env` tenga las variables:

```env
VITE_SUPABASE_URL=https://nwwnnnjppycdrbeuzhnf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_VMhvz0P62edaNx618GDZUA_-rA5yzHq
```

No utilices una `service_role` ni una secret key en el frontend.

## Crear build de producción

```bash
npm run build
```

Antes de compilar, el proyecto ejecuta `scripts/verify-env.mjs`. Si falta `.env`, la URL apunta a otro proyecto o la clave no parece una clave pública válida, el build se detendrá para evitar publicar una versión rota.

El resultado se genera en la carpeta `build/`.

## Deploy a Firebase Hosting

Inicia sesión una vez:

```bash
firebase login
```

Comprueba que tienes acceso al proyecto:

```bash
firebase projects:list
```

Publica desde `main`, después de confirmar y subir los cambios:

```bash
git switch main
git pull --ff-only origin main
npm run deploy:production
```

Firebase publica el contenido de `build/` según `firebase.json`.
El hook `predeploy` detiene la publicación si la rama no es `main`, hay código
sin confirmar, `HEAD` no coincide con `origin/main` o falta en su historia el
commit que ya está publicado. También ejecuta las pruebas de regresión y genera
un build nuevo. Antes de subirlo vuelve a comprobar el estado de Git y exige que
el build corresponda al mismo commit y a la misma huella del código fuente.

Cada compilación incluye `/release.json` con el commit, la rama, la fecha,
el estado del código y su huella SHA-256. Si producción no tiene una versión
verificable, la publicación se detiene para investigarla antes de reemplazarla.
Los controles evitan publicar accidentalmente otra rama o un build atrasado;
las pruebas y la revisión siguen siendo necesarias para detectar regresiones.

## Flujo recomendado para futuras actualizaciones

```bash
git switch main
git pull --ff-only origin main
npm ci
# Editar, revisar y confirmar los archivos del cambio.
git push origin main
npm run deploy:production
```

Conserva tu `.env` existente. Si utilizas una rama temporal para aislar trabajo,
intégrala en `main` antes de publicar; ninguna rama de trabajo es fuente de
producción. No uses `reset --hard`, no descartes trabajo local y no promociones
versiones antiguas de Hosting para saltarte estas comprobaciones.

La auditoría de funciones históricas pendientes está en
[`docs/AUDITORIA_COBERTURA_PUBLICADA_2026_11_10.md`](docs/AUDITORIA_COBERTURA_PUBLICADA_2026_11_10.md).
