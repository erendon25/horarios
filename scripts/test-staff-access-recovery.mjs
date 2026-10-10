import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';

const source = readFileSync(new URL('../supabase/functions/staff-account-admin/index.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '');
const compiled = (await transform(source, { loader: 'ts', format: 'esm' })).code;
async function run(options = {}) {
  let handler;
  const repairs = [];
  const profile = { id: 'user', role: 'collaborator', status: 'pending', store_id: 'store', staff_profile_id: 'staff', registration_pending: false, ...options.profile };
  const staff = { id: 'staff', user_id: 'user', store_id: 'store', email: 'person@example.com', status: 'pending', ...options.staff };
  const service = {
    auth: { getUser: async () => ({ data: { user: { id: 'user', email: 'person@example.com' } } }) },
    from(table) {
      return { select() { return this; }, eq() { return this; },
        maybeSingle: async () => ({ data: table === 'user_profiles' ? profile : table === 'staff_profiles' ? staff : { is_active: options.activeStore !== false } }) };
    },
    async rpc(name, args) {
      if (name === 'consume_rate_limit') return { data: [{ allowed: true }] };
      repairs.push({ name, args });
      return { data: options.repaired !== false, error: options.repairError ? { message: 'failed' } : null };
    },
  };
  vm.runInNewContext(compiled, { Deno: { env: { get: () => 'configured' }, serve: fn => { handler = fn; } }, createClient: () => service, Response, console, Intl, Date, Set });
  const response = await handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'recover_existing_staff_link' }) }));
  return { status: response.status, body: await response.json(), repairs };
}
const recovered = await run();
assert.equal(recovered.status, 200);
assert.equal(recovered.body.linked, true);
assert.equal(recovered.repairs[0].name, 'recover_current_staff_access');
assert.equal(recovered.repairs[0].args.p_user_id, 'user');
assert.equal(recovered.repairs[0].args.p_email, 'person@example.com');
assert.equal((await run({ profile: { status: 'active' }, staff: { status: 'active' } })).repairs.length, 0);
assert.equal((await run({ profile: { status: 'active' } })).repairs.length, 1);
for (const options of [
  { profile: { status: 'inactive' } }, { staff: { status: 'inactive' } },
  { staff: { email: 'other@example.com' } }, { staff: { cessation_date: '2000-01-01' } },
  { staff: { is_trainee: true, training_end_date: '2000-01-01' } }, { activeStore: false },
]) {
  const result = await run(options);
  assert.equal(result.status, 409);
  assert.equal(result.repairs.length, 0);
}
for (const options of [ { profile: { role: 'admin' } }, { profile: { staff_profile_id: null } }, { staff: { user_id: 'other' } }, { staff: { store_id: 'other' } } ]) {
  const result = await run(options);
  assert.equal(result.body.linked, false);
  assert.equal(result.repairs.length, 0);
}
assert.equal((await run({ repaired: false })).status, 500);
assert.equal((await run({ repairError: true })).status, 500);
assert.equal((await run({ staff: { cessation_date: '2099-01-01' } })).status, 200);
console.log('PASS: pending recovery, idempotency, identity/store guards, inactive/ended exclusions and failed repair');
