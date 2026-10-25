import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { invokeStaffAccountAdmin } from '../src/services/staffAccountAdmin.js';

const source = readFileSync(new URL('../supabase/functions/staff-account-admin/index.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '');
const compiled = (await transform(source, { loader: 'ts', format: 'esm' })).code;
const targetId = '11111111-1111-4111-8111-111111111111';

async function run(operation, options = {}) {
  let handler;
  const writes = [], clients = [], lookups = [];
  const service = {
    storage: { from: (bucket) => ({ remove: async (paths) => { writes.push({ bucket, paths }); return { error: options.storageError }; } }) },
    auth: {
      getUser: async () => options.noSession ? { error: {} } : { data: { user: { id: 'caller' } } },
      admin: { updateUserById: async (id, values) => { writes.push({ id, values }); return { error: options.updateError }; } },
    },
    rpc: async (name, args) => {
      if (name === 'consume_rate_limit') return { data: [{ allowed: !options.rateLimited }] };
      writes.push({ name, args });
      return options.rpcError || (!args.p_operation.startsWith('inspect_') && options.finalError)
        ? { error: options.rpcError || options.finalError }
        : { data: args.p_operation.startsWith('inspect_') ? { userId: targetId, files: options.files || [] } : { deleted: true } };
    },
    from(table) {
      let id;
      return {
        select() { return this; }, eq(key, value) { if (key === 'id') id = value; if (table === 'staff_profiles') lookups.push({ key, value }); return this; }, order() { return this; },
        async range(start) { return { data: options.paged && start === 0 ? Array.from({ length: 500 }, (_, i) => ({ id: i })) : [{ id: targetId, email: 'admin@example.com' }] }; },
        async maybeSingle() {
          if (table === 'staff_profiles') return { data: options.missingStaff ? null : { id: targetId, store_id: options.targetStoreId ?? 'store-a' }, error: options.lookupError };
          if (table === 'stores') return { data: options.missingStore ? null : { id: 'store-a', is_active: options.storeActive ?? true }, error: options.storeError };
          return { data: id === 'caller' ? { role: options.role ?? 'superadmin', status: options.status ?? 'active', store_id: Object.hasOwn(options, 'storeId') ? options.storeId : 'store-a' } : { id: targetId, role: options.targetRole ?? 'admin' } };
        },
      };
    },
  };
  vm.runInNewContext(compiled, {
    Deno: { env: { get: () => 'configured' }, serve: (fn) => { handler = fn; } },
    createClient: (...args) => { clients.push(args); return service; }, Response, console, Intl, Date, Set,
  });
  const response = await handler(new Request('https://example.test', {
    method: 'POST', headers: { authorization: 'Bearer verified-token', 'content-type': 'application/json' },
    body: JSON.stringify({ operation, userId: targetId, staffId: targetId, email: ' NEW@EXAMPLE.COM ', ...options.body }),
  }));
  return { status: response.status, body: await response.json(), writes, clients, lookups };
}

for (const operation of ['list_admins', 'update_admin', 'delete_admin', 'delete_staff', 'unlink_staff']) {
  for (const role of operation === 'delete_staff' ? ['trainer', 'collaborator'] : ['admin', 'trainer', 'collaborator']) {
    const result = await run(operation, { role });
    assert.equal(result.status, 403); assert.equal(result.writes.length, 0);
  }
  assert.equal((await run(operation, { status: 'inactive' })).status, 403);
  assert.equal((await run(operation, { noSession: true })).status, 401);
}
const listed = await run('list_admins', { paged: true });
assert.equal(listed.body.admins.length, 501);
assert.equal(listed.writes.length, 0);
const edited = await run('update_admin');
assert.equal(edited.status, 200);
assert.equal(edited.writes[0].values.email, 'new@example.com');
assert.equal(Object.hasOwn(edited.writes[0].values, 'password'), false);
const reset = await run('update_admin', { body: { password: 'New-Password-123!' } });
assert.equal(reset.writes[0].values.password, 'New-Password-123!');
for (const body of [{ email: 'invalid' }, { password: 'short' }, { userId: 'invalid' }, { password: null }]) {
  const result = await run('update_admin', { body }); assert.equal(result.status, 400); assert.equal(result.writes.length, 0);
}
for (const targetRole of ['superadmin', 'trainer', 'collaborator']) {
  const result = await run('update_admin', { targetRole }); assert.equal(result.status, 404); assert.equal(result.writes.length, 0);
}
assert.equal((await run('update_admin', { updateError: { code: 'email_exists' } })).body.error, 'email_already_registered');
assert.equal((await run('update_admin', { rateLimited: true })).status, 429);
for (const operation of ['delete_staff', 'unlink_staff']) {
  const result = await run(operation);
  assert.equal(result.status, 200);
  assert.equal(result.writes[0].name, 'superadmin_manage_staff_account');
  assert.equal(result.writes[0].args.p_operation, `inspect_${operation}`);
  assert.equal(result.writes[1].args.p_operation, operation);
  assert.equal(result.writes[1].args.p_expected_user_id, targetId);
  assert.equal(result.clients[1][2].global.headers.Authorization, 'Bearer verified-token');
  assert.equal(result.lookups.length, 0, 'UUID targets do not need legacy lookup');
  for (const staffId of [null, '', {}, 123, 'a/b', 'x'.repeat(129)]) {
    const invalid = await run(operation, { body: { staffId } });
    assert.equal(invalid.status, 400); assert.equal(invalid.writes.length, 0);
  }
  const legacyId = 'qNHFKmWNSgUEXBvbyBIm';
  const migrated = await run(operation, { body: { staffId: legacyId } });
  assert.equal(migrated.status, 200);
  assert.deepEqual(migrated.lookups, [{ key: 'firestore_id', value: legacyId }]);
  assert.ok(migrated.writes.every(write => write.args.p_staff_id === targetId));
  for (const [options, status, error] of [
    [{ missingStaff: true }, 404, 'staff_not_found'],
    [{ lookupError: {} }, 500, 'staff_lookup_failed'],
    ...(operation === 'unlink_staff' ? [[{ role: 'admin' }, 403, 'forbidden']] : []),
    [{ rateLimited: true }, 429, 'rate_limited'],
  ]) {
    const rejected = await run(operation, { ...options, body: { staffId: legacyId } });
    assert.equal(rejected.status, status); assert.equal(rejected.body.error, error);
    assert.equal(rejected.writes.length, 0);
    if (status === 403 || status === 429) assert.equal(rejected.lookups.length, 0);
  }
  assert.equal((await run(operation, { body: { staffId: legacyId }, rpcError: { message: 'protected_account' } })).status, 409);
  assert.equal((await run(operation, { rateLimited: true })).status, 429);
  assert.equal((await run(operation, { rpcError: { message: 'protected_account' } })).status, 409);
}

// Store administrators gain only delete_staff, with their live store checked
// before inspecting files. SQL independently enforces the target's store.
const adminOwn = await run('delete_staff', { role: 'admin' });
assert.equal(adminOwn.status, 200);
assert.equal(adminOwn.writes[0].args.p_operation, 'inspect_delete_staff');
assert.equal(adminOwn.writes[1].args.p_operation, 'delete_staff');
assert.equal(adminOwn.clients[1][2].global.headers.Authorization, 'Bearer verified-token');
const adminLegacy = await run('delete_staff', { role: 'admin', body: { staffId: 'legacy-store-staff' } });
assert.equal(adminLegacy.status, 200);
assert.ok(adminLegacy.lookups.some(lookup => lookup.key === 'store_id' && lookup.value === 'store-a'), 'Legacy admin lookup must be scoped to caller store');
for (const options of [
  { storeId: null }, { missingStore: true }, { storeActive: false }, { storeError: {} },
]) {
  const blocked = await run('delete_staff', { role: 'admin', ...options });
  assert.equal(blocked.status >= 400, true);
  assert.equal(blocked.writes.length, 0, 'Missing/inactive store must be denied before RPC, Storage or Auth writes');
}
for (const message of ['forbidden', 'protected_account', 'account_link_conflict']) {
  const blocked = await run('delete_staff', { role: 'admin', files: [{ bucket: 'profile-photos', path: `${targetId}/private.jpg` }], rpcError: { message } });
  assert.equal(blocked.status, message === 'forbidden' ? 403 : 409);
  assert.equal(blocked.writes.length, 1, 'Only readonly inspect RPC may run after a target permission failure');
  assert.equal(blocked.writes[0].args.p_operation, 'inspect_delete_staff');
  assert.equal(blocked.writes.some(write => write.bucket || write.values || write.args?.p_operation === 'delete_staff'), false);
}
const files = [{ bucket: 'profile-photos', path: `${targetId}/profile.jpg` }];
const adminDeleted = await run('delete_admin', { files });
assert.equal(adminDeleted.status, 200);
assert.equal(adminDeleted.writes[0].name, 'superadmin_manage_admin_account');
assert.equal(adminDeleted.writes[0].args.p_user_id, targetId);
assert.equal(adminDeleted.writes[0].args.p_operation, 'inspect_delete_admin');
assert.equal(adminDeleted.writes[2].args.p_operation, 'delete_admin');
assert.equal(adminDeleted.clients[1][2].global.headers.Authorization, 'Bearer verified-token');
assert.equal((await run('delete_admin', { body: { userId: 'invalid' } })).status, 400);
assert.equal((await run('delete_admin', { rpcError: { message: 'admin_not_found' } })).status, 404);
assert.equal((await run('delete_admin', { rpcError: { message: 'protected_account' } })).status, 409);
assert.equal((await run('delete_admin', { rateLimited: true })).status, 429);
const failedAdminFiles = await run('delete_admin', { files, storageError: {} });
assert.equal(failedAdminFiles.body.error, 'staff_files_removal_failed');
assert.equal(failedAdminFiles.writes.some((write) => write.args?.p_operation === 'delete_admin'), false);
const withFiles = await run('delete_staff', { files });
assert.equal(withFiles.status, 200);
assert.equal(withFiles.writes[1].bucket, 'profile-photos');
assert.equal(withFiles.writes[1].paths[0], files[0].path);
assert.equal(withFiles.writes[2].args.p_operation, 'delete_staff');
const storageFailure = await run('delete_staff', { files, storageError: { message: 'offline' } });
assert.equal(storageFailure.body.error, 'staff_files_removal_failed');
assert.equal(storageFailure.writes.some(w => w.args?.p_operation === 'delete_staff'), false);
const afterFilesFailure = await run('delete_staff', { files, finalError: { message: 'account_link_conflict' } });
assert.equal(afterFilesFailure.body.error, 'staff_operation_after_files_failed');
const clientAuth = { getSession: async () => ({ data: { session: { access_token: 'test', user: { id: 'caller' } } } }) };
await assert.rejects(() => invokeStaffAccountAdmin({ auth: clientAuth, functions: { invoke: async () => ({ error: { context: new Response(JSON.stringify({ error: 'account_link_conflict' })) } }) } }, {}), /vínculos inconsistentes/);
await assert.rejects(() => invokeStaffAccountAdmin({ auth: clientAuth, functions: { invoke: async () => ({ error: { context: new Response('not json') } }) } }, {}), /No se pudo completar/);
console.log('PASS: admin listing/pagination, editing email/password, authorization, protected roles, validation, rate limits, staff operations and readable errors');
