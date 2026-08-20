import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { documents } = JSON.parse(await readFile(resolve('migration/exports/firestore-documents.json'), 'utf8'));
const { users: authUsers } = JSON.parse(await readFile(resolve('migration/exports/auth-users.json'), 'utf8'));
const root = (name) => documents.filter((doc) => doc.collectionPath === name);
const staff = root('staff_profiles');
const staffIds = new Set(staff.map((doc) => doc.id));
const staffUids = new Set(staff.map((doc) => doc.data.uid).filter(Boolean));
const staffLegacyIds = new Set(staff.map((doc) => doc.data.id).filter(Boolean));
const ceseStaffIds = new Set(root('ceses').map((doc) => doc.data.staffId).filter(Boolean));
const holidayStaffIds = new Set(root('feriados_trabajados').map((doc) => doc.data.staffId).filter(Boolean));
const requestStaffIds = new Set(root('schedule_requests').map((doc) => doc.data.staffId).filter(Boolean));
const authUids = new Set(authUsers.map((user) => user.uid));
const identifiers = new Map();

for (const doc of root('schedules')) {
  const week = doc.data.weekKey ?? doc.id.match(/(\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!week) continue;
  const identifier = doc.id.endsWith(`_${week}`) ? doc.id.slice(0, -(week.length + 1)) : doc.id;
  const item = identifiers.get(identifier) ?? { documents: 0, storeIds: new Set() };
  item.documents += 1;
  if (doc.data.storeId) item.storeIds.add(doc.data.storeId);
  identifiers.set(identifier, item);
}

const categories = {};
let orphanDocuments = 0;
let orphanIdentifiers = 0;
let orphansWithStore = 0;
for (const [identifier, info] of identifiers) {
  let category = 'orphan';
  if (staffIds.has(identifier)) category = 'staff_doc_id';
  else if (staffUids.has(identifier)) category = 'staff_uid';
  else if (staffLegacyIds.has(identifier)) category = 'staff_legacy_id';
  else if (authUids.has(identifier)) category = 'auth_uid_without_staff';
  else if (ceseStaffIds.has(identifier)) category = 'cessation_staff_id';
  else if (holidayStaffIds.has(identifier)) category = 'holiday_staff_id';
  else if (requestStaffIds.has(identifier)) category = 'request_staff_id';
  categories[category] ??= { identifiers: 0, documents: 0, with_store: 0 };
  categories[category].identifiers += 1;
  categories[category].documents += info.documents;
  if (info.storeIds.size) categories[category].with_store += 1;
  if (category === 'orphan') {
    orphanIdentifiers += 1;
    orphanDocuments += info.documents;
    if (info.storeIds.size) orphansWithStore += 1;
  }
}

console.log(JSON.stringify({ total_identifiers: identifiers.size, categories, orphanIdentifiers, orphanDocuments, orphansWithStore }));
