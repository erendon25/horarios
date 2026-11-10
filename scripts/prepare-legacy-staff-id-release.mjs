import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = resolve('tmp/session-access-release');
const destination = resolve('tmp/legacy-staff-id-release');
assert.equal(createHash('sha256').update(await readFile(`${base}/build/assets/index-BeH5Pe5h.js`)).digest('hex'), '845698c2ce803583660c8c1b2ab6f171f8bb4f3f7811ff86db5ab47b267edffe');
await assert.rejects(access(destination), 'Refusing to overwrite an existing release');
await mkdir(destination, { recursive: true });
for (const directory of ['src', 'public', 'build', 'scripts']) await cp(`${base}/${directory}`, `${destination}/${directory}`, { recursive: true });
for (const file of ['.env', '.firebaserc', 'firebase.json', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'tailwind.config.js', 'postcss.config.js']) await cp(`${base}/${file}`, `${destination}/${file}`);
// Keep the deployed compatibility layer; unrelated local features are not part of this fix.
const path = `${destination}/src/lib/supabase/firestoreCompat.js`;
const previous = await readFile(path, 'utf8');
const pattern = /const mapStaff = \(row\) => \(\{\r?\n  \.\.\.legacy\(row\),/;
assert.match(previous, pattern);
await writeFile(path, previous.replace(pattern, '$&\n  // Imported ids must not override the native UUID.\n  id: row.id,'));
await cp('src/services/staffAccountAdmin.js', `${destination}/src/services/staffAccountAdmin.js`);
console.log(`Prepared legacy staff id release: ${destination}`);
