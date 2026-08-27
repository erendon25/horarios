import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
const expectedProjectRef = 'nwwnnnjppycdrbeuzhnf';

if (!fs.existsSync(envPath)) {
  console.error('\n❌ Falta el archivo .env en la raíz del proyecto.');
  console.error('   Crea uno copiando .env.example antes de ejecutar npm run build.\n');
  process.exit(1);
}

const raw = fs.readFileSync(envPath, 'utf8');
const values = {};

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separator = trimmed.indexOf('=');
  if (separator === -1) continue;
  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  values[key] = value;
}

const url = values.VITE_SUPABASE_URL;
const key = values.VITE_SUPABASE_PUBLISHABLE_KEY;
const errors = [];

if (!url) errors.push('Falta VITE_SUPABASE_URL.');
if (!key) errors.push('Falta VITE_SUPABASE_PUBLISHABLE_KEY.');

if (url && !url.includes(`${expectedProjectRef}.supabase.co`)) {
  errors.push(`VITE_SUPABASE_URL no apunta al proyecto esperado (${expectedProjectRef}).`);
}

if (key && !(key.startsWith('sb_publishable_') || key.startsWith('eyJ'))) {
  errors.push('VITE_SUPABASE_PUBLISHABLE_KEY no tiene un formato de clave pública reconocido.');
}

if (errors.length) {
  console.error('\n❌ Configuración de Supabase inválida:');
  for (const error of errors) console.error(`   - ${error}`);
  console.error('\nRevisa .env y vuelve a ejecutar npm run build.\n');
  process.exit(1);
}

console.log('✅ Variables de Supabase verificadas para el build.');
