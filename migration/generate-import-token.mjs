import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const secretsDir = resolve('migration/secrets');
const tokenPath = resolve(secretsDir, 'supabase-import-token.txt');
await mkdir(secretsDir, { recursive: true });

let token;
try {
  token = (await readFile(tokenPath, 'utf8')).trim();
} catch {
  token = randomBytes(48).toString('base64url');
  await writeFile(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
}

const sha256 = createHash('sha256').update(token).digest('hex');
console.log(JSON.stringify({ tokenPath, sha256 }));
