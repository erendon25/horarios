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

Luego despliega únicamente el hosting:

```bash
firebase deploy --only hosting:lc-scheduler
```

Firebase publica el contenido de `build/` según `firebase.json`.

## Flujo recomendado para futuras actualizaciones

```bash
git checkout main
git pull origin main
npm install
copy .env.example .env
npm run build
firebase deploy --only hosting:lc-scheduler
```

En Linux/macOS reemplaza `copy .env.example .env` por `cp .env.example .env`.
