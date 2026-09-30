import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const root = resolve('migration');
const secretsDir = join(root, 'secrets');
const exportsDir = join(root, 'exports');
const servicePath = join(secretsDir, 'firebase-service.json');

const serviceAccount = JSON.parse(await readFile(servicePath, 'utf8'));
if (serviceAccount.project_id !== 'lc-scheduler') {
  throw new Error('La clave no pertenece al proyecto lc-scheduler.');
}

initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth();
const db = getFirestore();
await mkdir(exportsDir, { recursive: true });

const users = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    users.push({
      uid: user.uid,
      email: user.email ?? null,
      emailVerified: user.emailVerified,
      disabled: user.disabled,
      displayName: user.displayName ?? null,
      phoneNumber: user.phoneNumber ?? null,
      photoURL: user.photoURL ?? null,
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      customClaims: user.customClaims ?? {},
      providerData: user.providerData,
      metadata: {
        creationTime: user.metadata.creationTime,
        lastSignInTime: user.metadata.lastSignInTime,
        lastRefreshTime: user.metadata.lastRefreshTime,
      },
      tokensValidAfterTime: user.tokensValidAfterTime,
      tenantId: user.tenantId ?? null,
    });
  }
  pageToken = page.pageToken;
} while (pageToken);

function normalize(value) {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map(normalize);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { __type: 'bytes', base64: Buffer.from(value).toString('base64') };
  }
  if (typeof value?.toDate === 'function') {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (typeof value?.latitude === 'number' && typeof value?.longitude === 'number') {
    return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  }
  if (typeof value?.path === 'string' && value?.firestore) {
    return { __type: 'reference', path: value.path };
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

const firestoreDocuments = [];
const collectionCounts = {};

async function exportCollection(collectionRef) {
  const snapshot = await collectionRef.get();
  collectionCounts[collectionRef.path] = snapshot.size;

  await Promise.all(snapshot.docs.map(async (document) => {
    firestoreDocuments.push({
      path: document.ref.path,
      collectionPath: collectionRef.path,
      id: document.id,
      data: normalize(document.data()),
    });

    const subcollections = await document.ref.listCollections();
    await Promise.all(subcollections.map(exportCollection));
  }));
}

const rootCollections = await db.listCollections();
await Promise.all(rootCollections.map(exportCollection));

const exportedAt = new Date().toISOString();
await writeFile(
  join(exportsDir, 'auth-users.json'),
  JSON.stringify({ projectId: serviceAccount.project_id, exportedAt, users }, null, 2),
  { encoding: 'utf8', mode: 0o600 },
);
await writeFile(
  join(exportsDir, 'firestore-documents.json'),
  JSON.stringify({ projectId: serviceAccount.project_id, exportedAt, documents: firestoreDocuments }, null, 2),
  { encoding: 'utf8', mode: 0o600 },
);
await writeFile(
  join(exportsDir, 'inventory.json'),
  JSON.stringify({
    projectId: serviceAccount.project_id,
    exportedAt,
    authUsers: users.length,
    usersWithPasswordHash: users.filter((user) => user.passwordHash).length,
    firestoreDocuments: firestoreDocuments.length,
    rootCollections: rootCollections.map((collectionRef) => collectionRef.id).sort(),
    collectionCounts,
  }, null, 2),
  { encoding: 'utf8', mode: 0o600 },
);

console.log(JSON.stringify({
  exportedAt,
  authUsers: users.length,
  usersWithPasswordHash: users.filter((user) => user.passwordHash).length,
  firestoreDocuments: firestoreDocuments.length,
  rootCollections: rootCollections.length,
}));
