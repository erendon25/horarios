import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const project = 'nwwnnnjppycdrbeuzhnf';
assert.equal(process.env.VERIFY_SUPERADMIN_PROJECT, project);
const keys = JSON.parse(execFileSync(process.env.SUPABASE_CLI_PATH, ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const url = `https://${project}.supabase.co`;
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient(url, keys.find(k => k.name === 'service_role').api_key, options);
const client = createClient(url, keys.find(k => k.name === 'anon').api_key, options);
const checked = result => { if (result.error) throw new Error(result.error.message); return result.data; };
const suffix = randomUUID();
const email = `qa-legacy-id-${suffix}@example.com`;
const password = `Q!${randomUUID()}aA9`;
const staffIds = new Set();
let userId, storeId, browser;
async function createStaff() {
  const legacyId = randomUUID().replaceAll('-', '').slice(0, 20);
  const staff = checked(await service.from('staff_profiles').insert({
    // Production forbids new firestore_id values. Reproduce the UI collision in
    // legacy_data without disabling that protection or changing existing staff.
    store_id: storeId, legacy_data: { id: legacyId },
    first_name: `QA Legacy ${suffix}`, last_name: 'Temporal', status: 'inactive', position: 'COLABORADOR',
  }).select('id').single());
  staffIds.add(staff.id);
  return { ...staff, legacyId };
}
async function invoke(body, expectedError) {
  const { data, error } = await client.functions.invoke('staff-account-admin', { body });
  const payload = error?.context?.json ? await error.context.json() : data;
  if (expectedError) { assert.equal(payload?.error, expectedError); return; }
  assert.equal(error, null, payload?.error);
  assert.equal(payload?.error, undefined);
  return payload;
}
try {
  storeId = checked(await service.from('stores').insert({ name: `QA legacy ${suffix}`, is_active: true }).select('id').single()).id;
  userId = checked(await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'superadmin', store_id: storeId } })).user.id;
  checked(await service.from('user_profiles').insert({ id: userId, email, role: 'superadmin', status: 'active', store_id: storeId, registration_pending: false }));
  const session = checked(await client.auth.signInWithPassword({ email, password })).session;
  const legacyTarget = await createStaff();
  await invoke({ operation: 'delete_staff', staffId: legacyTarget.legacyId }, 'staff_not_found');
  assert.equal((await invoke({ operation: 'unlink_staff', staffId: legacyTarget.id })).unlinked, true);
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', legacyTarget.id)).length, 1);
  assert.equal((await invoke({ operation: 'delete_staff', staffId: legacyTarget.id })).deleted, true);
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', legacyTarget.id)).length, 0);
  await invoke({ operation: 'delete_staff', staffId: legacyTarget.id }, 'staff_not_found');
  console.log('PASS live API: missing legacy id returns not-found; native unlink/delete succeed');

  const uiTarget = await createStaff();
  const { chromium } = await import('../tmp/competition-test-runtime/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext();
  await context.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key: `sb-${project}-auth-token`, session });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://lc-scheduler.web.app/superadmin');
  await page.getByPlaceholder('Buscar por nombre...').fill(suffix);
  const button = page.getByRole('button', { name: 'Eliminar definitivo', exact: true });
  await button.waitFor();
  assert.equal(await button.count(), 1);
  page.once('dialog', dialog => dialog.dismiss());
  await button.click();
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', uiTarget.id)).length, 1);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/functions/v1/staff-account-admin') && response.request().postDataJSON()?.operation === 'delete_staff');
  page.once('dialog', dialog => dialog.accept());
  await button.click();
  const response = await responsePromise;
  assert.equal(response.request().postDataJSON().staffId, uiTarget.id, 'Published UI must send native UUID despite legacy_data.id');
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).deleted, true);
  await button.waitFor({ state: 'hidden' });
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', uiTarget.id)).length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS live web: migrated profile, cancel preserves record, confirmed delete sends UUID and removes record');
} finally {
  if (browser) await browser.close();
  const errors = [];
  if (userId) { const result = await service.auth.admin.deleteUser(userId); if (result.error) errors.push(result.error.message); }
  for (const id of staffIds) { const result = await service.from('staff_profiles').delete().eq('id', id); if (result.error) errors.push(result.error.message); }
  if (storeId) { const result = await service.from('stores').delete().eq('id', storeId); if (result.error) errors.push(result.error.message); }
  assert.deepEqual(errors, [], 'Disposable fixture cleanup');
  console.log('CLEANUP: disposable account, staff and store removed');
}
