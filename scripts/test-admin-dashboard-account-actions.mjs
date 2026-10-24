import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = await readFile('src/components/AdminDashboard.jsx', 'utf8');
for (const [handler, next, operation, args] of [
  ['handleDelete', 'filteredStaff', 'delete_staff', ['account', 'staff']],
  ['handleUnlinkEmail', 'fetchStoreName', 'unlink_staff', ['staff']],
]) {
  const start = source.indexOf(`    const ${handler} = async`);
  const end = source.indexOf(`    const ${next} =`, start);
  assert.ok(start >= 0 && end > start);
  for (const role of ['superadmin', 'admin']) {
    for (const accepted of [false, true]) {
      for (const failed of [false, true]) {
        const calls = [];
        let changed = false;
        const context = vm.createContext({
          userRole: role, busyAccountId: null, supabase: {},
          window: { confirm: () => accepted }, alert() {}, console: { error() {} },
          setBusyAccountId() {}, setStaff() { changed = true; },
          fetchAllStaffProfiles: async () => { changed = true; },
          deleteDoc() { throw new Error('Direct table deletion must never run'); },
          updateDoc() { throw new Error('Direct account unlink must never run'); },
          invokeStaffAccountAdmin: async (_client, body) => { calls.push(body); if (failed) throw new Error('Server rejected operation'); },
        });
        vm.runInContext(`${source.slice(start, end)};globalThis.invoke = ${handler};`, context);
        await context.invoke(...args);
        const allowed = role === 'superadmin' && accepted;
        assert.equal(calls.length, allowed ? 1 : 0);
        if (allowed) { assert.equal(calls[0].operation, operation); assert.equal(calls[0].staffId, 'staff'); }
        assert.equal(changed, allowed && !failed);
      }
    }
  }
}
assert.equal(/deleteDoc\(doc\(db, ["'](?:staff_profiles|users)["']/.test(source), false);
console.log('PASS: dashboard delete/unlink call the secure endpoint only after superadmin confirmation; rejected operations keep local records');
