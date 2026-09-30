import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const projectUrl = 'https://nwwnnnjppycdrbeuzhnf.supabase.co';
const functionUrl = `${projectUrl}/functions/v1/firebase-auth-import`;
const users = JSON.parse(await readFile(resolve('migration/transformed/auth_users.json'), 'utf8'));
const token = (await readFile(resolve('migration/secrets/supabase-import-token.txt'), 'utf8')).trim();
const batchSize = 20;
const totals = { expected: users.length, processed: 0, created: 0, existing: 0, errors: 0, batches: 0 };
const privateErrors = [];

for (let offset = 0; offset < users.length; offset += batchSize) {
  const batch = users.slice(offset, offset + batchSize).map((user) => ({
    id: user.id,
    email: user.email,
    email_verified: user.email_verified,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  }));
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-migration-token': token },
    body: JSON.stringify({ operation: 'import_auth_users', users: batch }),
  });
  const result = await response.json();
  if (!response.ok && response.status !== 207) throw new Error(`Falló el lote ${totals.batches + 1}: ${result.error ?? response.status}`);
  totals.processed += result.processed ?? 0;
  totals.created += result.created ?? 0;
  totals.existing += result.existing ?? 0;
  totals.errors += result.errors?.length ?? 0;
  totals.batches += 1;
  for (const error of result.errors ?? []) privateErrors.push({ source_index: offset + error.index, message: error.message });
  console.log(JSON.stringify({ batch: totals.batches, processed: totals.processed, errors: totals.errors }));
}

await writeFile(resolve('migration/transformed/auth-import-report.json'), JSON.stringify({ totals, errors: privateErrors }, null, 2), 'utf8');
console.log(JSON.stringify(totals));
if (totals.processed !== totals.expected || totals.errors) process.exitCode = 1;
