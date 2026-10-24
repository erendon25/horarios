import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Include the deployed sales fix and only the account-management changes.
const base = resolve('tmp/sales-channel-hotfix');
const destination = resolve('tmp/superadmin-release');
const bundle = await readFile(`${base}/build/assets/index-jJ6ORD-h.js`);
assert.equal(createHash('sha256').update(bundle).digest('hex'), '169984c703c61e59a3a8998fc4c49979997408536f48477c2791ad382a1cec65');
await assert.rejects(access(destination), 'Refusing to overwrite an existing release');
await mkdir(destination, { recursive: true });
for (const directory of ['src', 'public', 'build', 'scripts']) {
  await cp(`${base}/${directory}`, `${destination}/${directory}`, { recursive: true });
}
for (const file of ['.env', '.firebaserc', 'firebase.json', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'tailwind.config.js', 'postcss.config.js']) {
  await cp(`${base}/${file}`, `${destination}/${file}`);
}
for (const file of ['src/components/SuperAdminDashboard.jsx', 'src/components/AdminAccountsPanel.jsx', 'src/services/staffAccountAdmin.js']) {
  await cp(file, `${destination}/${file}`);
}
const appPath = `${destination}/src/App.jsx`;
let app = (await readFile(appPath, 'utf8')).replace(/\r\n/g, '\n');
assert.ok(app.includes('<ToastContainer />\n'));
assert.ok(app.includes('        <AppRouter />\n'));
app = app.replace('<ToastContainer />\n', '').replace('        <AppRouter />\n', '        <AppRouter />\n        <ToastContainer />\n');
await writeFile(appPath, app);
console.log(`Prepared superadmin release: ${destination}`);
