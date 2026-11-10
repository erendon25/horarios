import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Preserve the deployed BUK/HR release and its old lazy chunks. The pending
// superadmin release depends on Supabase migrations and is published separately.
const base = resolve('tmp/production-buk-rrhh');
const destination = resolve('tmp/sales-channel-hotfix');
const original = await readFile(`${base}/build/assets/index-BXgB4SB-.js`);
assert.equal(createHash('sha256').update(original).digest('hex'), 'ff6237564221b506c80950b7120b91956ec9d4751aae184090519e94b9d8274c');
await assert.rejects(access(destination), 'Refusing to overwrite an existing release directory');
await mkdir(destination, { recursive: true });
for (const directory of ['src', 'public', 'build']) await cp(`${base}/${directory}`, `${destination}/${directory}`, { recursive: true });
for (const file of ['.env', '.firebaserc', 'firebase.json', 'package.json', 'package-lock.json', 'vite.config.js', 'index.html', 'tailwind.config.js', 'postcss.config.js']) {
  await cp(`${base}/${file}`, `${destination}/${file}`);
}
await mkdir(`${destination}/scripts`);
await cp('scripts/verify-env.mjs', `${destination}/scripts/verify-env.mjs`);
const file = `${destination}/src/components/SalesAnalysis.jsx`;
let source = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
const replaceOnce = (before, after) => {
  assert.equal(source.split(before).length, 2, `Unexpected production source: ${before.slice(0, 65)}`);
  source = source.replace(before, after);
};
replaceOnce(`if (dayData.hourlyData) {
                            Object.entries(dayData.hourlyData).forEach(([hourStr, canalData]) => {`, `if (dayData.hourlyData || dayData.hourlyTxs) {
                            const hours = new Set([
                                ...Object.keys(dayData.hourlyData || {}),
                                ...Object.keys(dayData.hourlyTxs || {}),
                            ]);
                            hours.forEach((hourStr) => {
                                const canalData = dayData.hourlyData?.[hourStr] || {};`);
replaceOnce(`Object.entries(canalData).forEach(([canal, val]) => {`, `const channels = new Set([...Object.keys(canalData), ...Object.keys(dayData.hourlyTxs?.[hourStr] || {})]);
                                channels.forEach((canal) => {
                                    const val = Number(canalData[canal]) || 0;
                                    ['canalesHoras', 'canalesHorasTxs', 'canalesDias', 'canalesDiasTxs', 'canalesHorasPorFecha', 'canalesHorasTxsPorFecha'].forEach((key) => {
                                        agg[key][canal] ||= {};
                                    });`);
replaceOnce(`const txsVal = dayData.hourlyTxs?.[hourStr]?.[canal] || 0;`, `const txsVal = Number(dayData.hourlyTxs?.[hourStr]?.[canal]) || 0;`);
await writeFile(file, source);
console.log(`Prepared isolated sales hotfix: ${destination}`);
