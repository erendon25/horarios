import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exportsDir = resolve('migration/exports');
const outputDir = resolve('migration/transformed');
const authExport = JSON.parse(await readFile(resolve(exportsDir, 'auth-users.json'), 'utf8'));
const firestoreExport = JSON.parse(await readFile(resolve(exportsDir, 'firestore-documents.json'), 'utf8'));
await mkdir(outputDir, { recursive: true });

const docs = firestoreExport.documents;
const rootDocs = (name) => docs.filter((doc) => doc.collectionPath === name);
const timestamp = (value) => value?.__type === 'timestamp' ? value.value : value || null;
const cleanString = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const cleanDate = (value) => cleanString(value)?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
const cleanTime = (value) => {
  const match = cleanString(value)?.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
};
const number = (value, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
};
const durationMinutes = (data) => {
  if (Number.isFinite(data.durationMinutes)) return Math.max(0, Math.round(data.durationMinutes));
  if (Number.isFinite(data.totalExtraMinutes)) return Math.max(0, Math.round(data.totalExtraMinutes));
  const match = cleanString(data.duracion)?.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?/i);
  if (match && (match[1] || match[2])) return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return 0;
};
const uuid = (scope, sourceId) => {
  const hex = createHash('sha256').update(`lc-scheduler:${scope}:${sourceId}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
};
const slug = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'sin_codigo';
const addDays = (date, days) => {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
const legacy = (doc, extra = {}) => ({ firestore_path: doc.path, ...extra, ...doc.data });

const warnings = [];
const quarantined = [];
const excludedAuthEmails = new Set([
  'erendonmoyano@icloud.com',
  'erendonmoyano@outlook.com',
  'grendak72@gmail.com',
  'misti@lc-peru.com',
  'misti@lc.com',
  'nat.tinajeros.2216@gmail.com',
  'prueba@gmail.com',
  'prueba@misti.com',
  'prueba12@gmail.com',
  'prueba20@misti.com',
  'salinasnunezd@gmail.com',
]);
const tables = Object.fromEntries([
  'stores', 'auth_users', 'staff_profiles', 'user_profiles', 'staff_skills', 'store_positions',
  'store_positioning_requirements', 'schedule_weeks', 'schedule_shifts', 'study_schedule_days',
  'study_schedule_blocks', 'worked_holidays', 'extra_hours', 'cessations', 'schedule_requests',
  'training_evaluations', 'store_configs', 'sales_month_configs', 'sales_daily_history',
  'sales_hourly_history', 'sales_projections', 'sales_projection_hours', 'staffing_projection_hours',
  'sales_projection_templates',
].map((table) => [table, []]));

// Stores: include referenced historical stores so no foreign key is silently lost.
const storeDocs = rootDocs('stores');
const referencedStoreIds = new Set(storeDocs.map((doc) => doc.id));
for (const doc of docs) {
  if (doc.data?.storeId) referencedStoreIds.add(doc.data.storeId);
  const pathMatch = doc.path.match(/^stores\/([^/]+)\//);
  if (pathMatch) referencedStoreIds.add(pathMatch[1]);
}
const storeDocById = new Map(storeDocs.map((doc) => [doc.id, doc]));
const storeUuidByFirebaseId = new Map();
for (const firebaseId of [...referencedStoreIds].sort()) {
  const doc = storeDocById.get(firebaseId);
  const id = uuid('store', firebaseId);
  storeUuidByFirebaseId.set(firebaseId, id);
  tables.stores.push({
    id,
    firestore_id: firebaseId,
    name: cleanString(doc?.data.name) ?? `Tienda migrada ${firebaseId.slice(0, 6)}`,
    city: cleanString(doc?.data.ciudad),
    address: cleanString(doc?.data.direccion),
    is_active: Boolean(doc),
    legacy_data: doc ? legacy(doc) : { migration_placeholder: true, firebase_store_id: firebaseId },
  });
  if (!doc) warnings.push({ code: 'MISSING_STORE_DOCUMENT', source_id: firebaseId });
}

// Deterministic Supabase UUIDs are shared by Auth and all public-table references.
const authByUid = new Map(authExport.users.map((user) => [user.uid, user]));
const authByEmail = new Map(authExport.users.filter((user) => user.email).map((user) => [user.email.trim().toLowerCase(), user]));
const canonicalAuthByEmail = new Map();
for (const user of authExport.users) {
  const key = user.email?.trim().toLowerCase() ?? `uid:${user.uid}`;
  if (!canonicalAuthByEmail.has(key)) canonicalAuthByEmail.set(key, user);
}
const authUuidByUid = new Map(authExport.users.map((user) => {
  const key = user.email?.trim().toLowerCase() ?? `uid:${user.uid}`;
  const canonical = canonicalAuthByEmail.get(key);
  return [user.uid, uuid('auth-user', canonical.uid)];
}));
const userDocs = rootDocs('users');
const userDocByUid = new Map(userDocs.map((doc) => [doc.id, doc]));
const userDocByEmail = new Map(userDocs.filter((doc) => doc.data.email).map((doc) => [doc.data.email.trim().toLowerCase(), doc]));

const staffDocs = rootDocs('staff_profiles');
const staffById = new Map(staffDocs.map((doc) => [doc.id, doc]));
const staffByUid = new Map(staffDocs.filter((doc) => doc.data.uid).map((doc) => [doc.data.uid, doc]));
const staffByEmail = new Map(staffDocs.filter((doc) => doc.data.email).map((doc) => [doc.data.email.trim().toLowerCase(), doc]));
const staffByDni = new Map(staffDocs.filter((doc) => doc.data.dni).map((doc) => [doc.data.dni.trim(), doc]));
const staffUuidById = new Map(staffDocs.map((doc) => [doc.id, uuid('staff', doc.id)]));

const authUidForStaff = (doc) => {
  if (doc.data.uid && authByUid.has(doc.data.uid)) return doc.data.uid;
  return authByEmail.get(doc.data.email?.trim().toLowerCase())?.uid ?? null;
};
const staffForOperational = (data) => {
  if (data.staffId && staffById.has(data.staffId)) return staffById.get(data.staffId);
  if (data.uid && staffByUid.has(data.uid)) return staffByUid.get(data.uid);
  if (data.uid && staffById.has(data.uid)) return staffById.get(data.uid);
  if (data.dni && staffByDni.has(String(data.dni).trim())) return staffByDni.get(String(data.dni).trim());
  return null;
};
const userUuidForValue = (value) => {
  if (!value) return null;
  if (authUuidByUid.has(value)) return authUuidByUid.get(value);
  const byEmail = authByEmail.get(String(value).trim().toLowerCase());
  return byEmail ? authUuidByUid.get(byEmail.uid) : null;
};

for (const doc of staffDocs) {
  const data = doc.data;
  const authUid = authUidForStaff(doc);
  const cessationDate = cleanDate(data.cessationDate);
  const isTrainee = Boolean(data.isTrainee) && !cessationDate;
  const modalityChangeDate = cleanDate(data.modalityChangeDate);
  const nextModality = ['Full-Time', 'Part-Time'].includes(data.nextModality) && modalityChangeDate ? data.nextModality : null;
  tables.staff_profiles.push({
    id: staffUuidById.get(doc.id),
    firestore_id: doc.id,
    user_id: authUid ? authUuidByUid.get(authUid) : null,
    store_id: storeUuidByFirebaseId.get(data.storeId),
    first_name: cleanString(data.name) ?? 'Sin nombre',
    last_name: cleanString(data.lastName) ?? '',
    email: cleanString(data.email),
    dni: cleanString(data.dni),
    gender: ['MASCULINO', 'FEMENINO'].includes(data.gender) ? data.gender : null,
    birth_date: cleanDate(data.birthDate),
    modality: ['Full-Time', 'Part-Time'].includes(data.modality) ? data.modality : null,
    position: cleanString(data.position) ?? 'COLABORADOR',
    status: ['active', 'inactive', 'pending'].includes(data.status) ? data.status : 'pending',
    join_date: cleanDate(data.joinDate),
    cessation_date: cessationDate,
    sanitary_card_expiry: cleanDate(data.sanitaryCardDate),
    sanitary_card_unlock: Boolean(data.sanitaryCardUnlock),
    is_trainee: isTrainee,
    training_end_date: cleanDate(data.trainingEndDate),
    modality_change_date: nextModality ? modalityChangeDate : null,
    next_modality: nextModality,
    needs_completion: Boolean(data.needsCompletion),
    holiday_balance: number(data.feriados),
    last_evaluation_date: cleanDate(data.lastEvaluationDate),
    last_evaluation_score: data.lastEvaluationScore ?? null,
    last_station_evaluated: cleanString(data.lastStationEvaluated),
    training_scores: data.trainingScores ?? {},
    position_abilities: data.positionAbilities ?? [],
    pending_holidays: data.pendingHolidays ?? [],
    created_at: timestamp(data.createdAt) ?? undefined,
    linked_at: data.linked ? timestamp(data.updatedAt) : null,
    legacy_data: legacy(doc),
  });
  for (const skill of Array.isArray(data.skills) ? data.skills : []) {
    const skillCode = typeof skill === 'string' ? skill : skill?.code ?? skill?.id ?? skill?.name;
    if (skillCode) tables.staff_skills.push({ staff_id: staffUuidById.get(doc.id), skill_code: String(skillCode) });
  }
}

const staffRowByAuthId = new Map(tables.staff_profiles.filter((row) => row.user_id).map((row) => [row.user_id, row]));
for (const user of authExport.users) {
  const emailKey = user.email?.trim().toLowerCase() ?? `uid:${user.uid}`;
  if (excludedAuthEmails.has(emailKey)) {
    warnings.push({ code: 'AUTH_ACCOUNT_EXCLUDED', email: emailKey });
    continue;
  }
  const canonicalUser = canonicalAuthByEmail.get(emailKey);
  if (canonicalUser.uid !== user.uid) continue;
  const id = authUuidByUid.get(user.uid);
  const firestoreUser = userDocByUid.get(user.uid) ?? userDocByEmail.get(user.email?.trim().toLowerCase());
  const staffDoc = staffByUid.get(user.uid) ?? staffByEmail.get(user.email?.trim().toLowerCase());
  const role = ['superadmin', 'admin', 'trainer', 'collaborator'].includes(firestoreUser?.data.role)
    ? firestoreUser.data.role : 'collaborator';
  // Conserva también la tienda operativa del superadmin. La aplicación histórica
  // usa ese vínculo para ventas, proyección, RRHH y horarios.
  const sourceStoreId = firestoreUser?.data.storeId ?? staffDoc?.data.storeId ?? null;
  const displayParts = cleanString(user.displayName)?.split(/\s+/) ?? [];
  const staffId = staffDoc ? staffUuidById.get(staffDoc.id) : null;
  tables.auth_users.push({
    id,
    firebase_uid: user.uid,
    email: user.email,
    email_verified: Boolean(user.emailVerified),
    disabled: Boolean(user.disabled),
    password_hash: user.passwordHash,
    password_salt: user.passwordSalt,
    created_at: user.metadata?.creationTime ?? null,
    last_sign_in_at: user.metadata?.lastSignInTime ?? null,
    app_metadata: { role, firebase_provider_data: user.providerData?.map((provider) => provider.providerId) ?? [] },
    user_metadata: {
      display_name: cleanString(user.displayName)
        ?? ([cleanString(staffDoc?.data.name), cleanString(staffDoc?.data.lastName)].filter(Boolean).join(' ') || null),
      phone_number: user.phoneNumber,
      photo_url: user.photoURL,
    },
  });
  tables.user_profiles.push({
    id,
    firebase_uid: user.uid,
    store_id: sourceStoreId ? storeUuidByFirebaseId.get(sourceStoreId) : null,
    staff_profile_id: staffId,
    email: user.email,
    first_name: cleanString(staffDoc?.data.name) ?? displayParts[0] ?? null,
    last_name: cleanString(staffDoc?.data.lastName) ?? (displayParts.length > 1 ? displayParts.slice(1).join(' ') : null),
    role,
    status: user.disabled ? 'inactive' : 'active',
    registration_pending: !firestoreUser,
    created_at: timestamp(firestoreUser?.data.createdAt) ?? user.metadata?.creationTime ?? undefined,
    legacy_data: {
      ...(firestoreUser ? legacy(firestoreUser) : { auth_only_user: true }),
      merged_firebase_uids: authExport.users
        .filter((candidate) => (candidate.email?.trim().toLowerCase() ?? `uid:${candidate.uid}`) === emailKey)
        .map((candidate) => candidate.uid),
    },
  });
}

// Reconstruct minimal inactive staff records for historical schedules whose profile was deleted.
// This keeps operational history queryable; needs_completion marks them for later reconciliation.
const historicalUnknownStoreSourceId = '__historical_unassigned__';
const historicalUnknownStoreId = uuid('store', historicalUnknownStoreSourceId);
const historicalEvidence = new Map();
const addHistoricalEvidence = (identifier, evidence) => {
  if (!identifier || staffById.has(identifier) || staffByUid.has(identifier)) return;
  const current = historicalEvidence.get(identifier) ?? {};
  historicalEvidence.set(identifier, { ...current, ...Object.fromEntries(Object.entries(evidence).filter(([, value]) => value !== null && value !== undefined && value !== '')) });
};
for (const doc of rootDocs('schedules')) {
  const weekKey = cleanString(doc.data.weekKey) ?? doc.id.match(/(\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2})$/)?.[1];
  if (!weekKey) continue;
  const identifier = doc.id.endsWith(`_${weekKey}`) ? doc.id.slice(0, -(weekKey.length + 1)) : doc.id;
  addHistoricalEvidence(identifier, { storeId: doc.data.storeId, source: 'schedules' });
}
for (const doc of rootDocs('study_schedules')) {
  const hasSchedule = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    .some((day) => doc.data[day] && typeof doc.data[day] === 'object');
  if (hasSchedule) addHistoricalEvidence(doc.data.uid ?? doc.id, { uid: doc.data.uid ?? doc.id, source: 'study_schedules' });
}
for (const doc of rootDocs('ceses')) addHistoricalEvidence(doc.data.staffId, {
  storeId: doc.data.storeId,
  name: doc.data.name,
  lastName: doc.data.lastName,
  dni: doc.data.dni,
  modality: doc.data.modality,
  position: doc.data.position,
  joinDate: doc.data.joinDate,
  cessationDate: doc.data.cessationDate,
  source: 'ceses',
});
for (const doc of rootDocs('feriados_trabajados')) addHistoricalEvidence(doc.data.staffId ?? doc.data.uid, {
  storeId: doc.data.storeId,
  uid: doc.data.uid,
  source: 'feriados_trabajados',
});
for (const doc of rootDocs('schedule_requests')) addHistoricalEvidence(doc.data.staffId, {
  storeId: doc.data.storeId,
  uid: doc.data.uid,
  source: 'schedule_requests',
});
for (const doc of rootDocs('extra_hours')) addHistoricalEvidence(doc.data.staffId, {
  storeId: doc.data.storeId,
  uid: doc.data.uid,
  name: doc.data.name,
  lastName: doc.data.lastName,
  dni: doc.data.dni,
  modality: doc.data.modality,
  position: doc.data.position ?? doc.data.cargo,
  source: 'extra_hours',
});

if ([...historicalEvidence.values()].some((evidence) => !evidence.storeId)) {
  tables.stores.push({
    id: historicalUnknownStoreId,
    firestore_id: historicalUnknownStoreSourceId,
    name: 'Histórico por identificar',
    city: null,
    address: null,
    is_active: false,
    legacy_data: { migration_placeholder: true, reason: 'historical_records_without_store' },
  });
  storeUuidByFirebaseId.set(historicalUnknownStoreSourceId, historicalUnknownStoreId);
  warnings.push({ code: 'HISTORICAL_UNASSIGNED_STORE_CREATED' });
}

for (const [identifier, evidence] of [...historicalEvidence].sort(([a], [b]) => a.localeCompare(b))) {
  if (staffById.has(identifier) || staffByUid.has(identifier)) continue;
  // Algunos horarios conservan el id de un perfil eliminado, mientras otros
  // documentos todavía guardan su uid o DNI. Si existe un perfil vigente con
  // esa identidad, reutilizamos su UUID y evitamos crear un colaborador histórico
  // duplicado. El alias también permite enlazar schedule_weeks al perfil correcto.
  const existingStaff = (evidence.uid && staffByUid.get(evidence.uid))
    || (evidence.dni && staffByDni.get(String(evidence.dni).trim()));
  if (existingStaff) {
    staffById.set(identifier, existingStaff);
    staffUuidById.set(identifier, staffUuidById.get(existingStaff.id));
    warnings.push({
      code: 'HISTORICAL_STAFF_RECONCILED',
      source_id: identifier,
      matched_staff_id: existingStaff.id,
      match: evidence.uid && existingStaff.data.uid === evidence.uid ? 'uid' : 'dni',
    });
    continue;
  }
  const firestoreUser = userDocByUid.get(identifier);
  const authUser = authByUid.get(identifier);
  const linkedAuthUser = authUser ?? (evidence.uid ? authByUid.get(evidence.uid) : null);
  const sourceStoreId = evidence.storeId ?? firestoreUser?.data.storeId ?? historicalUnknownStoreSourceId;
  const syntheticDoc = { id: identifier, path: `migration/reconstructed_staff/${identifier}`, data: { uid: evidence.uid ?? (authUser ? identifier : null), ...evidence, storeId: sourceStoreId } };
  const staffId = uuid('staff', identifier);
  staffUuidById.set(identifier, staffId);
  staffById.set(identifier, syntheticDoc);
  if (syntheticDoc.data.uid) staffByUid.set(syntheticDoc.data.uid, syntheticDoc);
  const candidateUserId = authUser ? authUuidByUid.get(identifier) : userUuidForValue(evidence.uid);
  const userId = candidateUserId && !tables.staff_profiles.some((row) => row.user_id === candidateUserId) ? candidateUserId : null;
  tables.staff_profiles.push({
    id: staffId,
    firestore_id: identifier,
    user_id: userId,
    store_id: storeUuidByFirebaseId.get(sourceStoreId) ?? historicalUnknownStoreId,
    first_name: cleanString(evidence.name) ?? `Histórico ${identifier.slice(0, 6)}`,
    last_name: cleanString(evidence.lastName) ?? '',
    email: linkedAuthUser?.email ?? null,
    dni: cleanString(evidence.dni),
    gender: null,
    birth_date: null,
    modality: ['Full-Time', 'Part-Time'].includes(evidence.modality) ? evidence.modality : null,
    position: cleanString(evidence.position) ?? 'COLABORADOR',
    // Una cuenta Auth vigente no prueba que el colaborador siga en planilla.
    // Todo perfil reconstruido exclusivamente desde historial permanece inactivo.
    status: 'inactive',
    join_date: cleanDate(evidence.joinDate),
    cessation_date: cleanDate(evidence.cessationDate),
    sanitary_card_expiry: null,
    sanitary_card_unlock: false,
    is_trainee: false,
    training_end_date: null,
    modality_change_date: null,
    next_modality: null,
    needs_completion: !(cleanString(evidence.name) && cleanString(evidence.lastName) && cleanString(evidence.dni)),
    holiday_balance: 0,
    last_evaluation_date: null,
    last_evaluation_score: null,
    last_station_evaluated: null,
    training_scores: {},
    position_abilities: [],
    pending_holidays: [],
    linked_at: null,
    legacy_data: { reconstructed_from_history: true, source_identifier: identifier, evidence },
  });
  if (userId) {
    const profile = tables.user_profiles.find((row) => row.id === userId);
    if (profile && !profile.staff_profile_id) {
      profile.staff_profile_id = staffId;
      profile.store_id ??= storeUuidByFirebaseId.get(sourceStoreId) ?? historicalUnknownStoreId;
      profile.first_name ??= cleanString(evidence.name);
      profile.last_name ??= cleanString(evidence.lastName);
    }
  }
}

// Positions and weekly positioning requirements.
const positionRowsByStoreAndCode = new Map();
const ensurePosition = (firebaseStoreId, position, source = {}) => {
  const storeId = storeUuidByFirebaseId.get(firebaseStoreId);
  const name = typeof position === 'string' ? position : position?.name ?? position?.id;
  if (!storeId || !name) return null;
  const code = slug(typeof position === 'object' && position.id ? position.id : name);
  const key = `${storeId}:${code}`;
  if (!positionRowsByStoreAndCode.has(key)) {
    const logic = typeof position === 'object' && ['capacity', 'service', 'driver', 'fixed'].includes(position.logic) ? position.logic : 'capacity';
    const optionalNumber = (value) => value === '' || value === null || value === undefined ? null : number(value, null);
    const optionalInteger = (value) => value === '' || value === null || value === undefined ? null : Math.max(0, Math.round(number(value)));
    const row = {
      migration_key: key,
      firestore_id: source.firestore_id ?? null,
      store_id: storeId,
      code,
      name: String(name),
      calculation_logic: logic,
      capacity: typeof position === 'object' ? optionalNumber(position.capacity) : null,
      factor: typeof position === 'object' ? optionalNumber(position.factor) ?? 1 : 1,
      ticket_average: typeof position === 'object' ? optionalNumber(position.ticketAverage) : null,
      transactions_per_collaborator: typeof position === 'object' ? optionalNumber(position.transactionsPerCollaborator) : null,
      fixed_staff: typeof position === 'object' ? optionalInteger(position.fixedStaff) : null,
      display_order: positionRowsByStoreAndCode.size,
      legacy_data: source,
    };
    positionRowsByStoreAndCode.set(key, row);
    tables.store_positions.push(row);
  }
  return key;
};

const nestedRequirements = docs.filter((doc) => /^stores\/[^/]+\/positioning_requirements$/.test(doc.collectionPath));
const storesWithNestedRequirements = new Set(nestedRequirements.map((doc) => doc.collectionPath.split('/')[1]));
for (const doc of nestedRequirements) {
  const firebaseStoreId = doc.collectionPath.split('/')[1];
  for (const position of doc.data.positions ?? []) ensurePosition(firebaseStoreId, position, { source_path: doc.path });
  tables.store_positioning_requirements.push({
    firestore_id: doc.id,
    store_id: storeUuidByFirebaseId.get(firebaseStoreId),
    requirement_key: doc.id,
    requirements: doc.data,
  });
}
const globalRequirements = rootDocs('positioning_requirements');
for (const firebaseStoreId of referencedStoreIds) {
  if (storesWithNestedRequirements.has(firebaseStoreId)) continue;
  for (const doc of globalRequirements) {
    for (const position of doc.data.positions ?? []) ensurePosition(firebaseStoreId, position, { source_path: doc.path, global_fallback: true });
    tables.store_positioning_requirements.push({
      firestore_id: `global:${doc.id}`,
      store_id: storeUuidByFirebaseId.get(firebaseStoreId),
      requirement_key: doc.id,
      requirements: { ...doc.data, migrated_from_global_fallback: true },
    });
  }
}

// Store configs and normalized positions from the weekly projection template.
for (const doc of docs.filter((item) => /^stores\/[^/]+\/config$/.test(item.collectionPath))) {
  const firebaseStoreId = doc.collectionPath.split('/')[1];
  tables.store_configs.push({
    firestore_id: doc.id,
    store_id: storeUuidByFirebaseId.get(firebaseStoreId),
    config_key: doc.id,
    value: doc.data,
  });
  if (doc.id === 'schedule_projection') {
    for (const position of doc.data.positions ?? []) ensurePosition(firebaseStoreId, position, { source_path: doc.path, projection_template: true });
    tables.sales_projection_templates.push({
      firestore_id: doc.id,
      store_id: storeUuidByFirebaseId.get(firebaseStoreId),
      positions: doc.data.positions ?? [],
      sales_by_day: doc.data.salesByDay ?? {},
      requirements: doc.data.requirements ?? {},
      manual_staff_by_day: doc.data.manualStaffByDay ?? {},
      source_updated_at: timestamp(doc.data.updatedAt),
      legacy_data: legacy(doc),
    });
  }
}

// Work schedules. A source document expands to one week and up to seven shifts.
const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const seenScheduleWeeks = new Set();
const scheduleScore = (doc) => {
  const weekKey = cleanString(doc.data.weekKey) ?? doc.id.match(/(\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2})$/)?.[1];
  const canonicalWeeklyId = weekKey && doc.id.endsWith(`_${weekKey}`);
  return (
    (canonicalWeeklyId ? 100 : 0)
    + (doc.data.weekKey ? 20 : 0)
    + (doc.data.storeId ? 20 : 0)
    + dayNames.filter((day) => doc.data[day] && typeof doc.data[day] === 'object').length
  );
};
for (const doc of [...rootDocs('schedules')].sort((a, b) => scheduleScore(b) - scheduleScore(a) || a.path.localeCompare(b.path))) {
  const weekKey = cleanString(doc.data.weekKey) ?? doc.id.match(/(\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2})$/)?.[1];
  const weekStart = cleanDate(weekKey);
  const staffSourceId = weekKey && doc.id.endsWith(`_${weekKey}`) ? doc.id.slice(0, -(weekKey.length + 1)) : doc.id;
  const staffDoc = staffById.get(staffSourceId) ?? staffByUid.get(staffSourceId);
  if (!weekStart || !staffDoc) {
    quarantined.push({ collection: 'schedules', path: doc.path, reason: !weekStart ? 'missing_week_start' : 'unknown_staff', data: doc.data });
    continue;
  }
  const staffId = staffUuidById.get(staffDoc.id);
  const storeId = storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc.data.storeId);
  const uniqueKey = `${staffId}:${weekStart}`;
  if (seenScheduleWeeks.has(uniqueKey)) {
    quarantined.push({ collection: 'schedules', path: doc.path, reason: 'duplicate_staff_week', data: doc.data });
    continue;
  }
  seenScheduleWeeks.add(uniqueKey);
  const migrationKey = `schedule:${doc.id}`;
  tables.schedule_weeks.push({ migration_key: migrationKey, firestore_id: doc.id, staff_id: staffId, store_id: storeId, week_start: weekStart, legacy_data: legacy(doc) });
  dayNames.forEach((day, index) => {
    const shift = doc.data[day];
    if (!shift || typeof shift !== 'object') return;
    const start = cleanTime(shift.start);
    const end = cleanTime(shift.end);
    const isDayOff = Boolean(shift.off);
    const isHoliday = Boolean(shift.feriado);
    if (!isDayOff && !isHoliday && (!start || !end)) return;
    tables.schedule_shifts.push({
      schedule_week_key: migrationKey,
      work_date: addDays(weekStart, index),
      start_time: start,
      end_time: end,
      position: cleanString(shift.position),
      is_day_off: isDayOff,
      is_holiday: isHoliday,
      notes: cleanString(shift.notes),
      metadata: shift,
    });
  });
}

// Study schedules. Empty placeholder documents are accounted for without inventing rows.
for (const doc of rootDocs('study_schedules')) {
  const staffDoc = staffById.get(doc.id) ?? staffByUid.get(doc.id) ?? staffByUid.get(doc.data.uid);
  const hasSchedule = dayNames.some((day) => doc.data[day] && typeof doc.data[day] === 'object');
  if (!staffDoc) {
    if (hasSchedule) quarantined.push({ collection: 'study_schedules', path: doc.path, reason: 'unknown_staff' });
    continue;
  }
  dayNames.forEach((day, weekday) => {
    const value = doc.data[day];
    if (!value || typeof value !== 'object') return;
    const dayKey = `study:${staffDoc.id}:${weekday}`;
    tables.study_schedule_days.push({ migration_key: dayKey, staff_id: staffUuidById.get(staffDoc.id), weekday, requests_day_off: Boolean(value.free) });
    for (const block of Array.isArray(value.blocks) ? value.blocks : []) {
      const start = cleanTime(block.start ?? block.startTime);
      const end = cleanTime(block.end ?? block.endTime);
      if (start && end && start !== end) tables.study_schedule_blocks.push({
        study_day_key: dayKey,
        staff_id: staffUuidById.get(staffDoc.id),
        weekday,
        start_time: start,
        end_time: end,
        metadata: block,
      });
    }
  });
}

for (const doc of rootDocs('feriados_trabajados')) {
  const staffDoc = staffForOperational(doc.data);
  if (!staffDoc) {
    quarantined.push({ collection: 'feriados_trabajados', path: doc.path, reason: 'unknown_staff' });
    continue;
  }
  const authUid = doc.data.uid && authByUid.has(doc.data.uid) ? doc.data.uid : authUidForStaff(staffDoc);
  tables.worked_holidays.push({
    firestore_id: doc.id,
    staff_id: staffUuidById.get(staffDoc.id),
    user_id: authUid ? authUuidByUid.get(authUid) : null,
    store_id: storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc.data.storeId),
    holiday_date: cleanDate(doc.data.date),
    name: cleanString(doc.data.name) ?? 'Feriado',
    balance_type: doc.data.type === 'compensado' ? 'compensado' : 'ganado',
    created_at: timestamp(doc.data.createdAt) ?? undefined,
    legacy_data: legacy(doc),
  });
}

for (const doc of rootDocs('extra_hours')) {
  const staffDoc = staffForOperational(doc.data);
  const authUid = doc.data.uid && authByUid.has(doc.data.uid) ? doc.data.uid : staffDoc ? authUidForStaff(staffDoc) : null;
  tables.extra_hours.push({
    firestore_id: doc.id,
    staff_id: staffDoc ? staffUuidById.get(staffDoc.id) : null,
    user_id: authUid ? authUuidByUid.get(authUid) : null,
    store_id: storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc?.data.storeId),
    work_date: cleanDate(doc.data.fecha ?? doc.data.periodStart ?? doc.data.importedAt),
    start_time: cleanTime(doc.data.inicio ?? doc.data.entrada),
    end_time: cleanTime(doc.data.fin ?? doc.data.salida),
    duration_minutes: durationMinutes(doc.data),
    pre_shift_minutes: Math.max(0, Math.round(number(doc.data.extraMinutesPre, number(doc.data.extraHoursPre) * 60))),
    post_shift_minutes: Math.max(0, Math.round(number(doc.data.extraMinutesPost, number(doc.data.extraHoursPost) * 60))),
    activity: cleanString(doc.data.actividad),
    source: cleanString(doc.data.source) ?? 'manual',
    source_file: cleanString(doc.data.sourceFile ?? doc.data.importedFrom),
    imported_at: timestamp(doc.data.importedAt),
    segments: doc.data.segments ?? [],
    daily_details: doc.data.dailyDetails ?? [],
    legacy_data: legacy(doc),
  });
}

for (const doc of rootDocs('ceses')) {
  const staffDoc = staffForOperational(doc.data);
  if (!staffDoc) {
    quarantined.push({ collection: 'ceses', path: doc.path, reason: 'unknown_staff' });
    continue;
  }
  tables.cessations.push({
    firestore_id: doc.id,
    staff_id: staffUuidById.get(staffDoc.id),
    store_id: storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc.data.storeId),
    join_date: cleanDate(doc.data.joinDate),
    cessation_date: cleanDate(doc.data.cessationDate),
    previous_modality: cleanString(doc.data.modality),
    next_modality: cleanString(doc.data.nextModality),
    is_modality_change: Boolean(doc.data.isModalityChange),
    performance: cleanString(doc.data.desempenio),
    cessation_reason: cleanString(doc.data.motivoCese)
      ?? (Boolean(doc.data.isModalityChange) ? null : 'SIN INFORMACIÓN HISTÓRICA'),
    real_reason: cleanString(doc.data.motivoReal)
      ?? (Boolean(doc.data.isModalityChange) ? null : 'SIN INFORMACIÓN HISTÓRICA'),
    store_comment: cleanString(doc.data.comentario),
    medical_leave_days: number(doc.data.diasDescansoMedico),
    absences: number(doc.data.inasistencias),
    tardiness: cleanString(doc.data.tardanzas),
    night_hours: number(doc.data.horasNocturnas),
    extra_hours: number(doc.data.horasExtras),
    holidays: number(doc.data.feriados),
    discounts: number(doc.data.descuentos),
    registered_at: timestamp(doc.data.registeredAt) ?? undefined,
    updated_at: timestamp(doc.data.lastUpdated) ?? undefined,
    legacy_data: legacy(doc),
  });
}

for (const doc of rootDocs('schedule_requests')) {
  const staffDoc = staffForOperational(doc.data);
  const userId = userUuidForValue(doc.data.uid) ?? (staffDoc ? tables.staff_profiles.find((row) => row.id === staffUuidById.get(staffDoc.id))?.user_id : null);
  if (!staffDoc || !userId) {
    quarantined.push({ collection: 'schedule_requests', path: doc.path, reason: !staffDoc ? 'unknown_staff' : 'unknown_auth_user' });
    continue;
  }
  tables.schedule_requests.push({
    firestore_id: doc.id,
    staff_id: staffUuidById.get(staffDoc.id),
    user_id: userId,
    store_id: storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc.data.storeId),
    requested_date: cleanDate(doc.data.date),
    shift_type: cleanString(doc.data.shiftType) ?? 'rango',
    start_time: cleanTime(doc.data.startTime),
    end_time: cleanTime(doc.data.endTime),
    reason: cleanString(doc.data.reason),
    status: ['pending', 'approved', 'rejected', 'cancelled'].includes(doc.data.status) ? doc.data.status : 'pending',
    reviewed_by: userUuidForValue(doc.data.reviewedBy),
    reviewed_at: timestamp(doc.data.reviewedAt),
    created_at: timestamp(doc.data.createdAt) ?? undefined,
    legacy_data: legacy(doc),
  });
}

for (const doc of rootDocs('training_evaluations')) {
  const staffDoc = staffById.get(doc.data.collaboratorId) ?? staffByUid.get(doc.data.collaboratorId);
  if (!staffDoc) {
    quarantined.push({ collection: 'training_evaluations', path: doc.path, reason: 'unknown_staff' });
    continue;
  }
  tables.training_evaluations.push({
    firestore_id: doc.id,
    staff_id: staffUuidById.get(staffDoc.id),
    trainer_id: userUuidForValue(doc.data.trainerId),
    store_id: storeUuidByFirebaseId.get(doc.data.storeId ?? staffDoc.data.storeId),
    evaluation_date: cleanDate(doc.data.date),
    area: cleanString(doc.data.area),
    station_code: cleanString(doc.data.station),
    station_name: cleanString(doc.data.stationName),
    score: doc.data.score ?? null,
    responses: doc.data.responses ?? {},
    feedback: doc.data.feedback ?? {},
    general_findings: cleanString(doc.data.generalFindings),
    status: doc.data.status === 'draft' ? 'draft' : 'completed',
    current_step: doc.data.step ?? null,
    collaborator_signature_path: cleanString(doc.data.collabSignature),
    trainer_signature_path: cleanString(doc.data.trainerSignature),
    is_edited: Boolean(doc.data.isEdited),
    created_at: timestamp(doc.data.timestamp) ?? undefined,
    updated_at: timestamp(doc.data.lastUpdated) ?? undefined,
    legacy_data: legacy(doc),
  });
}

for (const doc of docs.filter((item) => /^stores\/[^/]+\/sales_config$/.test(item.collectionPath))) {
  const firebaseStoreId = doc.collectionPath.split('/')[1];
  const month = doc.id.match(/^\d{4}-\d{2}$/)?.[0];
  if (!month) {
    quarantined.push({ collection: 'sales_config', path: doc.path, reason: 'invalid_month' });
    continue;
  }
  tables.sales_month_configs.push({
    firestore_id: doc.id,
    store_id: storeUuidByFirebaseId.get(firebaseStoreId),
    month_start: `${month}-01`,
    monthly_data: doc.data.monthlyData ?? {},
    daily_hourly_parts: doc.data.dailyHourlyParts ?? {},
    real_sales_data: { ...(doc.data.realSalesData ?? {}), hourlyParticipation: doc.data.hourlyParticipation ?? null },
  });
}

for (const doc of docs.filter((item) => /^stores\/[^/]+\/sales_history$/.test(item.collectionPath))) {
  const firebaseStoreId = doc.collectionPath.split('/')[1];
  const date = cleanDate(doc.id);
  if (!date) {
    quarantined.push({ collection: 'sales_history', path: doc.path, reason: 'invalid_date' });
    continue;
  }
  const dailyKey = `sales-day:${firebaseStoreId}:${date}`;
  tables.sales_daily_history.push({
    migration_key: dailyKey,
    firestore_id: doc.id,
    store_id: storeUuidByFirebaseId.get(firebaseStoreId),
    sales_date: date,
    sales_amount: doc.data.totalSales ?? null,
    transactions: doc.data.totalTxs ?? null,
    hourly_data: doc.data.hourlyData ?? {},
    source_data: legacy(doc),
  });
  for (const [hour, sales] of Object.entries(doc.data.hourlyData ?? {})) {
    const salesHour = cleanTime(hour.includes(':') ? hour : `${hour}:00`);
    if (!salesHour) continue;
    tables.sales_hourly_history.push({
      sales_daily_key: dailyKey,
      store_id: storeUuidByFirebaseId.get(firebaseStoreId),
      sales_date: date,
      sales_hour: salesHour,
      sales_amount: number(sales),
      transactions: Math.max(0, Math.round(number(doc.data.hourlyTxs?.[hour]))),
      source_data: { sales, transactions: doc.data.hourlyTxs?.[hour] ?? null },
    });
  }
}

// Every source document is either normalized above or deliberately retained/accounted for.
for (const doc of rootDocs('staff_schedules')) {
  quarantined.push({ collection: 'staff_schedules', path: doc.path, reason: 'obsolete_sample_collection', data: doc.data });
}

// PostgreSQL mantiene un único cese laboral regular por colaborador. Cuando
// Firebase contiene duplicados históricos, se conserva como fila operativa el
// registro más reciente y se anexan los anteriores completos en legacy_data.
const regularCessationsByStaff = Map.groupBy(
  tables.cessations.filter((row) => !row.is_modality_change),
  (row) => row.staff_id,
);
const consolidatedRegularCessations = [];
for (const [staffId, rows] of regularCessationsByStaff) {
  const sorted = rows.toSorted((left, right) => {
    const leftKey = `${left.cessation_date ?? ''}|${left.updated_at ?? ''}|${left.firestore_id}`;
    const rightKey = `${right.cessation_date ?? ''}|${right.updated_at ?? ''}|${right.firestore_id}`;
    return rightKey.localeCompare(leftKey);
  });
  const [current, ...historical] = sorted;
  if (historical.length) {
    current.legacy_data = {
      ...current.legacy_data,
      merged_regular_cessations: historical,
    };
    warnings.push({
      code: 'DUPLICATE_REGULAR_CESSATIONS_MERGED',
      staff_id: staffId,
      kept_firestore_id: current.firestore_id,
      merged: historical.length,
    });
  }
  consolidatedRegularCessations.push(current);
}
tables.cessations = [
  ...consolidatedRegularCessations,
  ...tables.cessations.filter((row) => row.is_modality_change),
];

const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
const report = {
  source: { exported_at: firestoreExport.exportedAt, auth_users: authExport.users.length, firestore_documents: docs.length },
  transformed_at: new Date().toISOString(),
  counts,
  warnings,
  quarantined,
  notes: [
    'auth_users conserva hashes SCRYPT solo para la fase segura de migración de Auth; no se inserta mediante tablas públicas.',
    'config/schedule_projection se conserva íntegramente en sales_projection_templates y store_configs; sus posiciones también se normalizan en store_positions.',
    'sales_projections queda vacío porque Firebase contiene una plantilla semanal por día de semana, no una proyección fechada por semana.',
  ],
};

for (const [table, rows] of Object.entries(tables)) {
  await writeFile(resolve(outputDir, `${table}.json`), JSON.stringify(rows, null, 2), { encoding: 'utf8', mode: 0o600 });
}
await writeFile(resolve(outputDir, 'id-map.json'), JSON.stringify({
  stores: Object.fromEntries(storeUuidByFirebaseId),
  auth_users: Object.fromEntries(authUuidByUid),
  staff_profiles: Object.fromEntries(staffUuidById),
}, null, 2), { encoding: 'utf8', mode: 0o600 });
await writeFile(resolve(outputDir, 'transformation-report.json'), JSON.stringify(report, null, 2), 'utf8');

console.log(JSON.stringify({ outputDir, counts, warnings: warnings.length, quarantined: quarantined.length }));
