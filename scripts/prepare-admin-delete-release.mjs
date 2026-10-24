import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = resolve('tmp/superadmin-release');
const destination = resolve('tmp/admin-delete-release');
const bundle = await readFile(`${base}/build/assets/index-BHW2FE_0.js`);
assert.equal(createHash('sha256').update(bundle).digest('hex'), '0cca60c7f75996f4b07b736b9d20846cc7c4b514f33188b6351f1efbaaf106b2');
await assert.rejects(access(destination), 'Refusing to overwrite an existing release');
await mkdir(destination, { recursive: true });
for (const directory of ['src', 'public', 'build', 'scripts']) {
  await cp(`${base}/${directory}`, `${destination}/${directory}`, { recursive: true });
}
for (const file of ['.env', '.firebaserc', 'firebase.json', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'tailwind.config.js', 'postcss.config.js']) {
  await cp(`${base}/${file}`, `${destination}/${file}`);
}
for (const file of ['src/components/SuperAdminDashboard.jsx', 'src/components/AdminAccountsPanel.jsx', 'src/components/AdminDashboard.jsx', 'src/services/staffAccountAdmin.js']) {
  await cp(file, `${destination}/${file}`);
}
console.log(`Prepared administrator deletion release: ${destination}`);
