import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = JSON.parse(await readFile(resolve('migration/exports/firestore-documents.json'), 'utf8'));

function mergeShape(target, value, depth = 0) {
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  target.types[type] = (target.types[type] ?? 0) + 1;
  if (depth >= 4 || value === null) return;

  if (Array.isArray(value)) {
    target.items ??= { types: {} };
    for (const item of value.slice(0, 50)) mergeShape(target.items, item, depth + 1);
  } else if (typeof value === 'object' && !value.__type) {
    target.fields ??= {};
    for (const [key, item] of Object.entries(value)) {
      target.fields[key] ??= { types: {} };
      mergeShape(target.fields[key], item, depth + 1);
    }
  }
}

const selected = new Set([
  'schedules',
  'study_schedules',
  'positioning_requirements',
  'extra_hours',
]);
const report = {};

for (const document of input.documents) {
  const rootCollection = document.collectionPath.split('/').at(-1);
  if (!selected.has(rootCollection) && rootCollection !== 'config' && rootCollection !== 'sales_config' && rootCollection !== 'sales_history') continue;
  report[document.collectionPath] ??= { types: {} };
  mergeShape(report[document.collectionPath], document.data);
}

await writeFile(resolve('migration/exports/nested-shape-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ collections: Object.keys(report).length }));
