import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { documents } = JSON.parse(await readFile(resolve('migration/exports/firestore-documents.json'), 'utf8'));
const projection = documents.find((doc) => doc.path.endsWith('/config/schedule_projection'));
if (!projection) throw new Error('No se encontró config/schedule_projection.');

const summarize = (value) => {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      itemKeys: [...new Set(value.flatMap((item) => item && typeof item === 'object' ? Object.keys(item) : []))].sort(),
    };
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return {
      type: 'object',
      keys: entries.map(([key]) => key).slice(0, 30),
      valueTypes: [...new Set(entries.map(([, item]) => Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item))].sort(),
      childKeys: [...new Set(entries.flatMap(([, item]) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : []))].sort(),
    };
  }
  return { type: value === null ? 'null' : typeof value };
};

console.log(JSON.stringify(Object.fromEntries(Object.entries(projection.data).map(([key, value]) => [key, summarize(value)])), null, 2));
