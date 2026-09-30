import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exportsDir = resolve('migration/exports');
const authExport = JSON.parse(await readFile(resolve(exportsDir, 'auth-users.json'), 'utf8'));
const firestoreExport = JSON.parse(await readFile(resolve(exportsDir, 'firestore-documents.json'), 'utf8'));

const docs = firestoreExport.documents;
const root = (name) => docs.filter((doc) => doc.collectionPath === name);
const frequency = (values) => Object.fromEntries(
  [...values.reduce((map, value) => {
    const key = value === null || value === undefined || value === '' ? '<empty>' : String(value);
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b)),
);

const authByUid = new Map(authExport.users.map((user) => [user.uid, user]));
const authByEmail = new Map(
  authExport.users
    .filter((user) => user.email)
    .map((user) => [user.email.trim().toLowerCase(), user]),
);
const userDocs = root('users');
const staffDocs = root('staff_profiles');
const staffIds = new Set(staffDocs.map((doc) => doc.id));
const staffByUid = new Map(staffDocs.filter((doc) => doc.data.uid).map((doc) => [doc.data.uid, doc]));

const report = {
  generatedAt: new Date().toISOString(),
  auth: {
    total: authExport.users.length,
    withPasswordHash: authExport.users.filter((user) => user.passwordHash).length,
    disabled: authExport.users.filter((user) => user.disabled).length,
    verified: authExport.users.filter((user) => user.emailVerified).length,
    firestoreUserMatchedByUid: userDocs.filter((doc) => authByUid.has(doc.id)).length,
    firestoreUserMatchedByEmail: userDocs.filter((doc) => authByEmail.has(doc.data.email?.trim().toLowerCase())).length,
  },
  users: {
    total: userDocs.length,
    roles: frequency(userDocs.map((doc) => doc.data.role)),
    storeIds: frequency(userDocs.map((doc) => doc.data.storeId)),
  },
  staff: {
    total: staffDocs.length,
    withUid: staffDocs.filter((doc) => doc.data.uid).length,
    uidInAuth: staffDocs.filter((doc) => doc.data.uid && authByUid.has(doc.data.uid)).length,
    uniqueUids: new Set(staffDocs.map((doc) => doc.data.uid).filter(Boolean)).size,
    statuses: frequency(staffDocs.map((doc) => doc.data.status)),
    modalities: frequency(staffDocs.map((doc) => doc.data.modality)),
    storeIds: frequency(staffDocs.map((doc) => doc.data.storeId)),
  },
  relations: {},
};

for (const [collection, staffField, uidField] of [
  ['ceses', 'staffId', null],
  ['extra_hours', 'staffId', 'uid'],
  ['feriados_trabajados', 'staffId', 'uid'],
  ['schedule_requests', 'staffId', 'uid'],
  ['training_evaluations', 'collaboratorId', 'trainerId'],
]) {
  const collectionDocs = root(collection);
  report.relations[collection] = {
    total: collectionDocs.length,
    withKnownStaffId: collectionDocs.filter((doc) => doc.data[staffField] && staffIds.has(doc.data[staffField])).length,
    resolvableByUid: uidField
      ? collectionDocs.filter((doc) => doc.data[uidField] && staffByUid.has(doc.data[uidField])).length
      : 0,
  };
}

await writeFile(resolve(exportsDir, 'relation-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report));
