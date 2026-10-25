// Keep the import payload limited to the personnel fields reviewed in preview.
export async function importStaffPlanilla(client, { storeId, rows, fileName }) {
  if (!storeId) throw new Error('No se pudo identificar la tienda. Vuelve a abrir el panel.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error('Selecciona entre 1 y 500 colaboradores nuevos.');
  const payload = rows.map(row => ({
    dni: String(row.dni ?? '').trim(),
    name: String(row.name ?? '').trim(),
    lastName: String(row.lastName ?? '').trim(),
    modality: row.modality,
    position: row.position,
    area: String(row.area ?? '').trim(),
  }));
  const { data, error } = await client.rpc('import_staff_planilla', {
    p_store_id: storeId,
    p_rows: payload,
    p_source_file: String(fileName ?? '').slice(0, 240),
  });
  if (error) throw new Error(error.message || 'No se pudieron agregar los colaboradores.');
  if (!data || !Array.isArray(data.created) || !Array.isArray(data.skipped)
    || data.createdCount !== data.created.length || data.skippedCount !== data.skipped.length) {
    throw new Error('No se pudo verificar el resultado de la importación. Actualiza la lista antes de volver a intentarlo.');
  }
  return data;
}
