import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const tests = [];
for (const directory of ['src/services', 'src/lib/supabase']) {
  for (const name of (await readdir(directory)).sort()) {
    if (name.endsWith('.test.js')) tests.push(`${directory}/${name}`);
  }
}
tests.push('scripts/verify-production-deploy.test.mjs');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test', ...tests], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
