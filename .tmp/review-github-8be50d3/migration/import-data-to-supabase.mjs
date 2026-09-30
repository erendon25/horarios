import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const functionUrl = 'https://nwwnnnjppycdrbeuzhnf.supabase.co/functions/v1/firebase-data-import';
const token = (await readFile(resolve('migration/secrets/supabase-import-token.txt'), 'utf8')).trim();
const order = [
  'stores',
  'staff_profiles',
  'user_profiles',
  'staff_skills',
  'store_positions',
  'store_positioning_requirements',
  'schedule_weeks',
  'schedule_shifts',
  'study_schedule_days',
  'study_schedule_blocks',
  'worked_holidays',
  'extra_hours',
  'cessations',
  'schedule_requests',
  'training_evaluations',
  'store_configs',
  'sales_month_configs',
  'sales_daily_history',
  'sales_hourly_history',
  'sales_projection_templates',
];
const batchSizes = { schedule_shifts: 100, sales_hourly_history: 100, study_schedule_blocks: 100 };
const requestedStartTable = process.env.MIGRATION_START_TABLE;
const startIndex = requestedStartTable ? order.indexOf(requestedStartTable) : 0;
if (requestedStartTable && startIndex < 0) throw new Error(`Tabla de reanudación no válida: ${requestedStartTable}`);
const importOrder = order.slice(startIndex);
const report = {
  started_at: new Date().toISOString(),
  resumed_from: requestedStartTable ?? null,
  tables: {},
  processed: 0,
  errors: [],
};

for (const table of importOrder) {
  const rows = JSON.parse(await readFile(resolve(`migration/transformed/${table}.json`), 'utf8'));
  const batchSize = batchSizes[table] ?? 150;
  report.tables[table] = { expected: rows.length, processed: 0, batches: 0 };
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-migration-token': token },
      body: JSON.stringify({ operation: 'upsert_public_rows', table, rows: batch }),
    });
    const result = await response.json();
    if (!response.ok) {
      report.errors.push({ table, offset, message: result.error ?? `HTTP ${response.status}` });
      await writeFile(resolve('migration/transformed/data-import-report.json'), JSON.stringify(report, null, 2), 'utf8');
      throw new Error(`Falló ${table} en el lote ${offset}: ${result.error ?? response.status}`);
    }
    report.tables[table].processed += result.processed;
    report.tables[table].batches += 1;
    report.processed += result.processed;
  }
  console.log(JSON.stringify({ table, processed: report.tables[table].processed, expected: rows.length }));
}

report.completed_at = new Date().toISOString();
await writeFile(resolve('migration/transformed/data-import-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ processed: report.processed, errors: report.errors.length }));
