import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = readFileSync(process.env.STAFF_COMPAT_SOURCE || 'src/lib/supabase/firestoreCompat.js', 'utf8')
  .replace(/^import .*;$/mg, '') + '\nglobalThis.compat = { getDocs, collection, db };';
const compiled = (await transform(source, { loader: 'js', format: 'cjs' })).code;
const nativeId = '11111111-1111-4111-8111-111111111111';
const rows = [
  { id: nativeId, firestore_id: 'qNHFKmWNSgUEXBvbyBIm', legacy_data: { id: 'qNHFKmWNSgUEXBvbyBIm', custom: 'preserved' } },
  { id: '22222222-2222-4222-8222-222222222222', legacy_data: {} },
];
const context = { module: { exports: {} }, exports: {}, trainingRecognition: () => ({}), mapSalesHistoryRow: () => ({}),
  supabase: { from: table => { assert.equal(table, 'staff_profiles'); return { select: async () => ({ data: rows }) }; } },
};
vm.runInNewContext(compiled, context);
const { getDocs, collection, db } = context.compat;
const snapshot = await getDocs(collection(db, 'staff_profiles'));
const profiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
assert.equal(profiles[0].id, nativeId);
assert.equal(profiles[0].custom, 'preserved');
assert.equal(profiles[1].id, rows[1].id);
console.log('PASS: actual staff snapshots preserve native UUIDs over imported Firestore ids');
