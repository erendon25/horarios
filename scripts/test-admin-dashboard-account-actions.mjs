import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { canDeleteStaffProfile } from '../src/services/staffAccountAdmin.js';

const source = await readFile('src/components/AdminDashboard.jsx', 'utf8');
let cases = 0;
for (const [handler, next, operation] of [
  ['handleDelete', 'filteredStaff', 'delete_staff'],
  ['handleUnlinkEmail', 'fetchStoreName', 'unlink_staff'],
]) {
  const start = source.indexOf(`    const ${handler} = async`);
  const end = source.indexOf(`    const ${next} =`, start);
  assert.ok(start >= 0 && end > start);
  for (const role of ['superadmin', 'admin', 'trainer', 'collaborator']) {
    for (const scope of ['own', 'other', 'missing', 'self', 'protected']) {
    for (const busy of [false, true]) {
    for (const accepted of [false, true]) {
      for (const failed of [false, true]) {
        const calls = [];
        let confirmations = 0;
        let changed = false;
        const profile = { id: 'staff', uid: scope === 'self' ? 'caller' : 'account',
          name: 'Persona', lastName: 'Prueba', storeId: 'store-a',
          accountRole: scope === 'protected' ? 'admin' : 'collaborator' };
        const context = vm.createContext({
          userRole: role, busyAccountId: busy ? 'busy-staff' : null, supabase: {},
          userData: { storeId: scope === 'missing' ? null : scope === 'other' ? 'store-b' : 'store-a' },
          currentUser: { uid: 'caller' }, canDeleteStaffProfile,
          window: { confirm: () => { confirmations++; return accepted; } }, alert() {}, console: { error() {} },
          setBusyAccountId() {}, setStaff() { changed = true; },
          fetchAllStaffProfiles: async () => { changed = true; },
          deleteDoc() { throw new Error('Direct table deletion must never run'); },
          updateDoc() { throw new Error('Direct account unlink must never run'); },
          invokeStaffAccountAdmin: async (_client, body) => { calls.push(body); if (failed) throw new Error('Server rejected operation'); },
        });
        vm.runInContext(`${source.slice(start, end)};globalThis.invoke = ${handler};`, context);
        await context.invoke(...(operation === 'delete_staff' ? [profile] : ['staff']));
        const eligible = operation === 'unlink_staff' ? role === 'superadmin'
          : !['self', 'protected'].includes(scope) && (role === 'superadmin' || (role === 'admin' && scope === 'own'));
        const allowed = eligible && accepted && !busy;
        assert.equal(calls.length, allowed ? 1 : 0);
        assert.equal(confirmations, eligible && !busy ? 1 : 0);
        if (allowed) { assert.equal(calls[0].operation, operation); assert.equal(calls[0].staffId, 'staff'); }
        assert.equal(changed, allowed && !failed);
        cases++;
      }
    }
    }
    }
  }
}
assert.equal(/deleteDoc\(doc\(db, ["'](?:staff_profiles|users)["']/.test(source), false);
assert.equal(canDeleteStaffProfile({ role: 'admin', storeId: 'store-a' }, null), false);
assert.equal(canDeleteStaffProfile({ role: 'admin', storeId: 'store-a' }, { storeId: 'store-a' }), false);
console.log(`PASS: ${cases} dashboard permission/confirmation/error scenarios; admin deletes only own-store staff, superadmin keeps global access, unlink stays restricted`);
