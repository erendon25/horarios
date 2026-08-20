import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve('migration/exports/firestore-documents.json');
const outputPath = resolve('migration/exports/shape-report.json');
const { documents } = JSON.parse(await readFile(inputPath, 'utf8'));

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value && typeof value === 'object' && value.__type) return value.__type;
  return typeof value;
}

const byCollection = new Map();
for (const document of documents) {
  const entry = byCollection.get(document.collectionPath) ?? {
    documents: 0,
    fields: {},
  };
  entry.documents += 1;

  for (const [field, value] of Object.entries(document.data ?? {})) {
    const fieldEntry = entry.fields[field] ?? { present: 0, types: {} };
    const type = valueType(value);
    fieldEntry.present += 1;
    fieldEntry.types[type] = (fieldEntry.types[type] ?? 0) + 1;
    entry.fields[field] = fieldEntry;
  }

  byCollection.set(document.collectionPath, entry);
}

const collections = Object.fromEntries(
  [...byCollection.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([collectionPath, entry]) => [
      collectionPath,
      {
        documents: entry.documents,
        fields: Object.fromEntries(
          Object.entries(entry.fields).sort(([a], [b]) => a.localeCompare(b)),
        ),
      },
    ]),
);

await writeFile(
  outputPath,
  JSON.stringify({ generatedAt: new Date().toISOString(), collections }, null, 2),
  'utf8',
);

console.log(JSON.stringify({ collections: Object.keys(collections).length, outputPath }));
