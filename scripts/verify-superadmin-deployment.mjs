import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Explicit opt-in: this creates disposable records in the specified live project.
// Secrets stay in memory. Only records created by this run are mutated/cleaned up.
assert.equal(process.env.VERIFY_SUPERADMIN_PROJECT, 'nwwnnnjppycdrbeuzhnf', 'Set VERIFY_SUPERADMIN_PROJECT explicitly');
assert.ok(process.env.SUPABASE_CLI_PATH, 'Set SUPABASE_CLI_PATH');
const project = process.env.VERIFY_SUPERADMIN_PROJECT;
const url = `https://${project}.supabase.co`;
const raw = execFileSync(process.env.SUPABASE_CLI_PATH, ['projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const keys = JSON.parse(raw);
const serviceKey = keys.find((key) => key.name === 'service_role')?.api_key;
const publicKey = keys.find((key) => key.name === 'anon')?.api_key;
assert.ok(serviceKey && publicKey, 'Expected project keys were not returned');
const options = { auth: { autoRefreshToken: false, persistSession: false } };
const service = createClient(url, serviceKey, options);
const accounts = new Set();
const staffIds = new Set();
let storeId;
let browser;
const suffix = randomUUID();
const email = (name) => `qa-${name}-${suffix}@example.com`;
const password = `Qa!${randomUUID()}aA9`;
const changedPassword = `Qa!${randomUUID()}bB8`;
const checked = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.code || result.error.status || 'failed'} ${result.error.message}`);
  return result.data;
};
async function createAccount(name, role, staffId = null) {
  const created = checked(await service.auth.admin.createUser({ email: email(name), password, email_confirm: true, app_metadata: { role, store_id: storeId } }), 'create disposable account').user;
  accounts.add(created.id);
  checked(await service.from('user_profiles').insert({ id: created.id, email: created.email, role, status: 'active', store_id: storeId, staff_profile_id: staffId, registration_pending: false }), 'create disposable profile');
  return created;
}
async function login(userEmail, userPassword = password) {
  const client = createClient(url, publicKey, options);
  const data = checked(await client.auth.signInWithPassword({ email: userEmail, password: userPassword }), 'sign in disposable account');
  return { client, session: data.session };
}
async function invoke(client, body, expectedError) {
  const { data, error } = await client.functions.invoke('staff-account-admin', { body });
  let payload = data;
  if (error?.context?.json) payload = await error.context.json();
  if (expectedError) {
    assert.equal(payload?.error, expectedError, `Expected rejection: ${body.operation}`);
    return payload;
  }
  if (error || payload?.error) throw new Error(`Edge ${body.operation}: ${payload?.error || error?.message}`);
  return payload;
}
async function createStaff(name) {
  const row = checked(await service.from('staff_profiles').insert({ store_id: storeId, first_name: 'Prueba temporal', last_name: name, position: 'COLABORADOR', status: 'active', email: email(name) }).select('id').single(), 'create disposable staff');
  staffIds.add(row.id);
  const user = await createAccount(name, 'collaborator', row.id);
  checked(await service.from('staff_profiles').update({ user_id: user.id, linked_at: new Date().toISOString() }).eq('id', row.id), 'link disposable staff');
  const signedIn = await login(user.email);
  return { id: row.id, user, ...signedIn };
}

try {
  storeId = checked(await service.from('stores').insert({ name: `Verificación temporal ${suffix}`, is_active: true }).select('id').single(), 'create disposable store').id;
  const superadmin = await createAccount('superadmin', 'superadmin');
  const supervisor = await login(superadmin.email);
  const admin = await invoke(supervisor.client, { operation: 'create_admin', email: email('admin'), password, storeId });
  assert.ok(admin.userId, 'Expected created administrator');
  accounts.add(admin.userId);
  let listed = await invoke(supervisor.client, { operation: 'list_admins' });
  assert.ok(listed.admins.some((row) => row.id === admin.userId), 'Created admin must appear');
  checked(await service.from('user_profiles').update({ status: 'inactive' }).eq('id', admin.userId), 'temporarily mark test admin inactive');
  listed = await invoke(supervisor.client, { operation: 'list_admins' });
  assert.equal(listed.admins.find((row) => row.id === admin.userId)?.status, 'inactive');
  checked(await service.from('user_profiles').update({ status: 'active' }).eq('id', admin.userId), 'restore test admin status');
  const regularAdmin = await login(email('admin'));
  await invoke(regularAdmin.client, { operation: 'list_admins' }, 'forbidden');
  console.log('PASS live: creation, admin directory including inactive accounts, and access control');

  // Exercise the actual published UI, with a real disposable superadmin session.
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '../tmp/competition-test-runtime/node_modules/playwright/index.mjs');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(({ key, session }) => { localStorage.setItem(key, JSON.stringify(session)); }, { key: `sb-${project}-auth-token`, session: supervisor.session });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://lc-scheduler.web.app/superadmin', { waitUntil: 'domcontentloaded' });
  const panel = page.getByRole('region', { name: /Administradores registrados/ });
  await panel.getByLabel('Buscar por correo, nombre o tienda').fill(email('admin'));
  await panel.getByRole('button', { name: 'Editar acceso' }).click();
  await panel.getByLabel('Correo electrónico').fill(email('edited-admin'));
  await panel.getByLabel('Nueva contraseña').fill(changedPassword);
  const updateResponsePromise = page.waitForResponse((response) => response.url().endsWith('/functions/v1/staff-account-admin') && response.request().postDataJSON()?.operation === 'update_admin');
  await panel.getByRole('button', { name: 'Guardar acceso' }).click();
  const updateResponse = await updateResponsePromise;
  const updateResult = await updateResponse.json();
  assert.equal(updateResponse.status(), 200, `Published edit failed: ${updateResult.error || 'unknown'}`);
  await page.getByText('Datos de acceso del administrador actualizados', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Guardar acceso' }).waitFor({ state: 'hidden' });
  await panel.getByLabel('Buscar por correo, nombre o tienda').fill(email('edited-admin'));
  await panel.getByRole('heading', { name: email('edited-admin'), exact: true }).waitFor();
  const profile = checked(await service.from('user_profiles').select('email').eq('id', admin.userId).single(), 'read test administrator email');
  assert.equal(profile.email, email('edited-admin'));
  await login(email('edited-admin'), changedPassword);
  const rejectedLogin = await createClient(url, publicKey, options).auth.signInWithPassword({ email: email('edited-admin'), password });
  assert.ok(rejectedLogin.error, 'Old password must stop working');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.getByRole('heading', { name: email('edited-admin'), exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Editar acceso' }).click();
  assert.equal(await panel.getByLabel('Nueva contraseña').inputValue(), '');
  await panel.getByRole('button', { name: 'Guardar acceso' }).click();
  await panel.getByRole('button', { name: 'Actualizar lista' }).click();
  await panel.getByRole('heading', { name: email('edited-admin'), exact: true }).waitFor();
  await login(email('edited-admin'), changedPassword);
  assert.deepEqual(errors, []);
  console.log('PASS live web: desktop/mobile admin list, email/password edit, profile synchronization, new login and blank-password preservation');

  const target = await createStaff('delete');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=', 'base64');
  const path = `${target.user.id}/profile.jpg`;
  checked(await target.client.storage.from('profile-photos').upload(path, image, { contentType: 'image/png' }), 'upload disposable owned photo');
  checked(await target.client.rpc('set_own_profile_photo', { p_object_path: path }), 'register disposable photo');
  await invoke(target.client, { operation: 'delete_staff', staffId: target.id }, 'forbidden');
  const deleted = await invoke(supervisor.client, { operation: 'delete_staff', staffId: target.id });
  assert.equal(deleted.deleted, true);
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', target.id), 'confirm staff deletion').length, 0);
  assert.ok((await service.auth.admin.getUserById(target.user.id)).error, 'Deleted Auth account must be absent');
  assert.equal(checked(await service.storage.from('profile-photos').list(target.user.id), 'confirm owned photo deletion').length, 0);
  await invoke(target.client, { operation: 'list_admins' }, 'invalid_session');
  console.log('PASS live: permanent staff/Auth/photo deletion and revoked account access');

  const unlinkTarget = await createStaff('unlink');
  const unlinked = await invoke(supervisor.client, { operation: 'unlink_staff', staffId: unlinkTarget.id });
  assert.equal(unlinked.unlinked, true);
  const remaining = checked(await service.from('staff_profiles').select('id,user_id,email').eq('id', unlinkTarget.id).single(), 'read retained staff profile');
  assert.equal(remaining.user_id, null);
  assert.equal(remaining.email, null);
  assert.ok((await service.auth.admin.getUserById(unlinkTarget.user.id)).error);
  await invoke(supervisor.client, { operation: 'delete_staff', staffId: unlinkTarget.id });
  assert.equal(checked(await service.from('staff_profiles').select('id').eq('id', unlinkTarget.id), 'confirm unlinked staff deletion').length, 0);
  console.log('PASS live: unlink preserves staff, removes Auth access, and unlinked staff can be permanently deleted');

  // Administrator deletion from the published panel, limited to this run's account.
  const adminSession = await login(email('edited-admin'), changedPassword);
  await invoke(adminSession.client, { operation: 'delete_admin', userId: admin.userId }, 'forbidden');
  await invoke(supervisor.client, { operation: 'delete_admin', userId: superadmin.id }, 'protected_account');
  await panel.getByLabel('Buscar por correo, nombre o tienda').fill(email('edited-admin'));
  page.once('dialog', (dialog) => dialog.dismiss());
  await panel.getByRole('button', { name: 'Eliminar administrador' }).click();
  assert.equal(checked(await service.from('user_profiles').select('id').eq('id', admin.userId), 'canceled deletion keeps admin').length, 1);
  page.once('dialog', (dialog) => dialog.accept());
  const deleteResponsePromise = page.waitForResponse((response) => response.url().endsWith('/functions/v1/staff-account-admin') && response.request().postDataJSON()?.operation === 'delete_admin');
  await panel.getByRole('button', { name: 'Eliminar administrador' }).click();
  const deleteResponse = await deleteResponsePromise;
  const deleteResult = await deleteResponse.json();
  assert.equal(deleteResponse.status(), 200, `Published admin deletion failed: ${deleteResult.error || 'unknown'}`);
  await page.getByText('Administrador y cuenta de acceso eliminados definitivamente', { exact: true }).waitFor();
  await panel.getByRole('heading', { name: email('edited-admin'), exact: true }).waitFor({ state: 'hidden' });
  assert.ok((await service.auth.admin.getUserById(admin.userId)).error);
  assert.equal(checked(await service.from('user_profiles').select('id').eq('id', admin.userId), 'deleted admin profile absent').length, 0);
  assert.equal(checked(await service.from('stores').select('id').eq('id', storeId), 'administrator store preserved').length, 1);
  await invoke(adminSession.client, { operation: 'list_admins' }, 'invalid_session');
  const recreated = await invoke(supervisor.client, { operation: 'create_admin', email: email('edited-admin'), password, storeId });
  accounts.add(recreated.userId);
  assert.notEqual(recreated.userId, admin.userId);
  console.log('PASS live: admin deletion through web, cancellation, superadmin protection, revoked access, preserved store and reusable email');
} finally {
  if (browser) await browser.close();
  const cleanupErrors = [];
  for (const id of accounts) {
    const result = await service.storage.from('profile-photos').remove([`${id}/profile.jpg`]);
    if (result.error) cleanupErrors.push(`photo ${id}: ${result.error.message}`);
  }
  for (const id of accounts) {
    const result = await service.auth.admin.deleteUser(id);
    if (result.error && result.error.status !== 404 && result.error.code !== 'user_not_found') cleanupErrors.push(`account ${id}: ${result.error.message}`);
  }
  for (const id of staffIds) {
    const result = await service.from('staff_profiles').delete().eq('id', id);
    if (result.error) cleanupErrors.push(`staff ${id}: ${result.error.message}`);
  }
  if (storeId) {
    const result = await service.from('stores').delete().eq('id', storeId);
    if (result.error) cleanupErrors.push(`store ${storeId}: ${result.error.message}`);
  }
  if (cleanupErrors.length) throw new Error(`Disposable fixture cleanup incomplete: ${cleanupErrors.join('; ')}`);
  console.log('CLEANUP: all disposable accounts, staff, files and store removed');
}
