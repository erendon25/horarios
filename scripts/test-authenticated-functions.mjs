import assert from 'node:assert/strict';
import { invokeAuthenticatedFunction } from '../src/lib/supabase/invokeAuthenticatedFunction.js';
const session = (token = 'old', id = 'user') => ({ access_token: token, user: { id } });
function fixture(status = 401) {
  const state = { session: session(), calls: [], refreshes: 0 };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.session } }),
      refreshSession: async () => { state.refreshes++; state.session = session('fresh'); return { data: { session: state.session } }; },
    },
    functions: { invoke: async (_name, options) => {
      state.calls.push(options);
      return options.headers.Authorization === 'Bearer fresh' || status === 200
        ? { data: { ok: true } } : { error: { context: new Response('{}', { status }) } };
    } },
  };
  return { state, client };
}
const options = { body: { operation: 'delete_admin', userId: 'target' } };
for (const status of [200, 401, 403, 500]) {
  const { client, state } = fixture(status);
  const result = await invokeAuthenticatedFunction(client, 'staff-account-admin', options);
  assert.equal(state.calls.length, status === 401 ? 2 : 1);
  assert.equal(state.refreshes, status === 401 ? 1 : 0);
  assert.equal(state.calls[0].headers.Authorization, 'Bearer old');
  assert.deepEqual(state.calls[0].body, options.body);
  if (status === 401) assert.equal(result.data.ok, true);
}
{
  const { client, state } = fixture(); state.session = null;
  assert.equal((await invokeAuthenticatedFunction(client, 'staff-account-admin')).error.context.status, 401);
  assert.equal(state.calls.length, 0);
}
{
  const { client, state } = fixture(); let reads = 0;
  client.auth.getSession = async () => ({ data: { session: ++reads === 1 ? session() : session('other', 'other-user') } });
  assert.equal((await invokeAuthenticatedFunction(client, 'staff-account-admin')).error.context.status, 401);
  assert.equal(state.calls.length, 1); assert.equal(state.refreshes, 0);
}
{
  const { client, state } = fixture();
  client.auth.refreshSession = async () => { state.refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return { data: { session: session('fresh') } }; };
  const results = await Promise.all([1, 2].map(() => invokeAuthenticatedFunction(client, 'staff-account-admin')));
  assert.equal(state.refreshes, 1); assert.ok(results.every(result => result.data.ok));
}
{
  const { client, state } = fixture();
  client.auth.refreshSession = async () => ({ data: { session: null }, error: new Error('expired') });
  assert.equal((await invokeAuthenticatedFunction(client, 'staff-account-admin')).error.context.status, 401);
  assert.equal(state.calls.length, 1);
}
console.log('PASS: explicit current JWT, one 401 refresh/retry, deduplicated refresh, account-switch protection and no replay on permission/server errors');
