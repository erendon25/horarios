import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { loginWithLegacyRecovery } from '../src/lib/supabase/loginWithLegacyRecovery.js';

const source = readFileSync(new URL('../supabase/functions/recover-legacy-staff-login/index.ts', import.meta.url), 'utf8').replace(/^import .*;$/mg, '');
const compiled = (await transform(source, { loader: 'ts', format: 'esm' })).code;
async function run(options = {}) {
  let handler;
  const calls = [];
  const logs = [];
  const approval = { approval_id: 'approval', staff_id: 'staff', firebase_uid: 'legacy', email: 'person@example.test', user_id: options.resumable ? 'created' : null };
  let preparations = 0;
  const service = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === 'prepare_approved_legacy_staff_login') {
        preparations++;
        return { data: options.unapproved ? null : { ...approval, ...(preparations > 1 && options.concurrent ? { user_id: 'concurrent' } : {}) }, error: options.prepareError ? {} : null };
      }
      if (name === 'consume_rate_limit') return { data: [{ allowed: !options.limited }], error: options.limitError ? {} : null };
      return { data: !options.completeError, error: options.completeError ? {} : null };
    },
    auth: { admin: { async createUser(args) {
      calls.push({ name: 'createUser', args });
      return options.createError || options.concurrent ? { data: {}, error: {} } : { data: { user: { id: 'created' } } };
    } } },
  };
  vm.runInNewContext(compiled, {
    Deno: { env: { get: () => 'configured' }, serve: fn => { handler = fn; } },
    console: { warn: message => logs.push(message) },
    createClient: () => service, Response, AbortSignal,
    async fetch(url, init) {
      calls.push({ name: 'firebase', url, body: JSON.parse(init.body) });
      if (options.network) throw Error('network');
      if (options.providerCode) return new Response(JSON.stringify({ error: { message: options.providerCode } }), { status: options.providerStatus || 400 });
      return new Response(JSON.stringify({ localId: options.otherUid ? 'someone-else' : 'legacy', email: options.otherEmail ? 'else@example.test' : 'person@example.test' }), { status: options.invalid || options.disabled ? 400 : 200 });
    },
  });
  const response = await handler(new Request('https://example.test', { method: options.method || 'POST', body: options.method ? undefined : options.raw || JSON.stringify({ email: ' Person@Example.Test ', password: 'Only a synthetic test password' }) }));
  return { status: response.status, body: response.status === 204 ? null : await response.json(), calls, logs };
}
for (const options of [{}, { resumable: true }, { concurrent: true }]) {
  const result = await run(options);
  assert.equal(result.status, 200);
  assert.equal(result.body.recovered, true);
  assert.equal(result.calls.find(c => c.name === 'complete_approved_legacy_staff_login').args.p_user_id, options.concurrent ? 'concurrent' : 'created');
  assert.equal(result.calls.filter(c => c.name === 'createUser').length, options.resumable ? 0 : 1);
  const created = result.calls.find(c => c.name === 'createUser');
  if (created) {
    assert.deepEqual(JSON.parse(JSON.stringify(created.args.app_metadata)), { legacy_staff_recovery_id: 'approval', firebase_uid: 'legacy' });
    assert.equal(created.args.email_confirm, true);
  }
  const firebase = result.calls.find(c => c.name === 'firebase');
  assert.equal(firebase.body.returnSecureToken, true);
  assert.equal(firebase.body.email, 'person@example.test');
}
for (const options of [{ invalid: true }, { disabled: true }, { otherUid: true }, { otherEmail: true }, { network: true }, { limited: true }, { limitError: true }, { unapproved: true }, { prepareError: true }]) {
  const result = await run(options);
  assert.equal(result.body.recovered, false);
  assert.equal(result.calls.some(c => ['createUser', 'complete_approved_legacy_staff_login'].includes(c.name)), false);
  if (options.limited || options.unapproved || options.prepareError || options.limitError) assert.equal(result.calls.some(c => c.name === 'firebase'), false);
}
for (const options of [{ createError: true }, { completeError: true }]) assert.equal((await run(options)).status, 503);
for (const [code, status] of [['INVALID_LOGIN_CREDENTIALS',401], ['USER_DISABLED',401], ['TOO_MANY_ATTEMPTS_TRY_LATER',429], ['OPERATION_NOT_ALLOWED',503], ['API_KEY_INVALID',503]]) {
  const result = await run({ providerCode: code });
  assert.equal(result.status,status);
  assert.equal(result.calls.some(c => ['createUser','complete_approved_legacy_staff_login'].includes(c.name)),false);
  assert.deepEqual(JSON.parse(result.logs[0]),{event:'legacy_staff_login_denied',stage:'legacy_password_verification',approval_id:'approval',provider_code:code});
}
assert.equal((await run({providerStatus:403,providerCode:'UNRECOGNIZED'})).status,503);
assert.equal((await run({providerStatus:500,providerCode:'UNRECOGNIZED'})).status,503);
for(const options of [{providerCode:'Sensitive synthetic provider text'}, {otherUid:true}, {otherEmail:true}, {unapproved:true}]) {
  const result=await run(options);
  assert.equal(result.status,401);
  const log=result.logs.join('\n');
  assert.ok(!log.includes('Synthetic') && !log.includes('synthetic') && !log.includes('person@example.test'));
  assert.equal(JSON.parse(result.logs[0]).stage,options.providerCode?'legacy_password_verification':options.unapproved?'approval_not_ready':'legacy_identity_mismatch');
}
assert.equal((await run({ method: 'GET' })).status, 405);
assert.equal((await run({ method: 'OPTIONS' })).status, 204);
assert.equal((await run({ raw: JSON.stringify({ email: 'person@example.test', password: '123' }) })).status, 400);
assert.equal((await run({ raw: 'a'.repeat(4097) })).status, 400);

const credentialError = { code: 'invalid_credentials' };
async function testLogin(options = {}) {
  const calls = [];
  const client = {
    auth: { async signInWithPassword(args) {
      calls.push({ kind: 'login', args });
      return options.normal || calls.filter(c => c.kind === 'login').length > 1
        ? { data: { user: { id: 'user', ...(options.partial ? { app_metadata: { legacy_staff_recovery_id: 'approval' } } : {}) }, session: {} } }
        : { error: options.nonCredential ? { code: 'over_request_rate_limit' } : credentialError };
    }, async signOut() { calls.push({ kind: 'signout' }); } },
    from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: null }; } }; },
    functions: { async invoke(name, { body }) {
      calls.push({ kind: 'recovery', name, body });
      if (options.network) throw Error('offline');
      return options.denied ? { error: {} } : { data: { recovered: true } };
    } },
  };
  let error;
  try { await loginWithLegacyRecovery(client, ' Person@Example.Test ', ' pass unchanged '); } catch (e) { error = e; }
  return { calls, error };
}
const successful = await testLogin();
assert.deepEqual(successful.calls.map(c => c.kind), ['login', 'recovery', 'login']);
assert.equal(successful.calls[1].name, 'recover-legacy-staff-login');
assert.equal(successful.calls[1].body.password, ' pass unchanged ');
assert.equal(successful.calls[1].body.email, 'person@example.test');
assert.equal((await testLogin({ normal: true })).calls.length, 1);
assert.equal((await testLogin({ nonCredential: true })).calls.length, 1);
assert.deepEqual((await testLogin({ normal: true, partial: true })).calls.map(c => c.kind), ['login','recovery','login']);
assert.deepEqual((await testLogin({ normal: true, partial: true, denied: true })).calls.map(c => c.kind), ['login','recovery','signout']);
for (const options of [{ denied: true }, { network: true }]) assert.equal((await testLogin(options)).error, credentialError);
console.log('PASS: validated legacy password only, denied identities, rate limits, retries without password overwrite, and normal login unchanged.');
