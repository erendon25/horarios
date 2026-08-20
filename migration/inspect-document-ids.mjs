import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { documents } = JSON.parse(await readFile(resolve('migration/exports/firestore-documents.json'), 'utf8'));
const safeCollections = documents.filter((doc) =>
  doc.collectionPath.includes('/config')
  || doc.collectionPath.includes('/sales_config')
  || doc.collectionPath.includes('/sales_history')
  || doc.collectionPath.includes('/positioning_requirements'),
);

console.log(JSON.stringify(safeCollections.map((doc) => ({ path: doc.path, fields: Object.keys(doc.data).sort() })), null, 2));
