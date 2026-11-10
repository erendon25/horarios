import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
const project = 'nwwnnnjppycdrbeuzhnf';
assert.equal(process.env.VERIFY_SUPERADMIN_PROJECT, project);
const keys = JSON.parse(execFileSync(process.env.SUPABASE_CLI_PATH, ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const service = createClient(`https://${project}.supabase.co`, keys.find(k => k.name === 'service_role').api_key, { auth: { autoRefreshToken: false, persistSession: false } });
const checked = (result) => { if (result.error) throw new Error(result.error.message); return result.data; };
const email = `qa-login-${randomUUID()}@example.com`;
const password = `Q!${randomUUID()}aA9`;
let userId, storeId, browser;
try {
  storeId = checked(await service.from('stores').insert({ name: 'Verificación temporal login', is_active: true }).select('id').single()).id;
  userId = checked(await service.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'superadmin', store_id: storeId } })).user.id;
  checked(await service.from('user_profiles').insert({ id: userId, email, role: 'superadmin', status: 'active', store_id: storeId, registration_pending: false }));
  const { chromium } = await import('../tmp/competition-test-runtime/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
  const page = await browser.newPage();
  const responses = [];
  let injected401 = false;
  let refreshes = 0;
  if (process.env.QA_REJECT_FIRST_FUNCTION === '1') {
    await page.route('**/functions/v1/staff-account-admin', async route => {
      if (!injected401 && route.request().method() === 'POST') {
        injected401 = true;
        return route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ error: 'invalid_session' }) });
      }
      return route.continue();
    });
  }
  page.on('response', response => {
    if (response.url().includes('/functions/v1/staff-account-admin')) responses.push(response.status());
    if (response.url().includes('grant_type=refresh_token') && response.status() === 200) refreshes++;
  });
  await page.goto('https://lc-scheduler.web.app/login');
  await page.getByLabel('Correo Electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL('**/superadmin');
  const panel = page.getByRole('region', { name: /Administradores registrados/ });
  await panel.getByRole('button', { name: 'Actualizar lista' }).waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes('Cargando administradores'));
  assert.ok(responses.includes(200), `Edge statuses: ${responses.join(',')}`);
  assert.equal(responses.includes(401), injected401);
  if (injected401) assert.ok(refreshes >= 1, 'A rejected session must be refreshed');
  assert.equal(await panel.getByRole('alert').count(), 0);
  await page.getByRole('button', { name: 'Regresar a Admin', exact: true }).click();
  await page.getByRole('button', { name: 'Salir', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin');
  await page.getByRole('button', { name: 'Superadmin', exact: true }).click();
  await panel.getByRole('button', { name: 'Actualizar lista' }).waitFor();
  await page.getByRole('button', { name: 'Regresar a Admin', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Salir', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/admin');
  console.log(`PASS live: real password login, both panels through navigation buttons, stable reload${injected401 ? ', and automatic recovery after an injected 401' : ''}`);
} finally {
  if (browser) await browser.close();
  if (userId) checked(await service.auth.admin.deleteUser(userId));
  if (storeId) checked(await service.from('stores').delete().eq('id', storeId));
  console.log('CLEANUP: disposable login account and store removed');
}
