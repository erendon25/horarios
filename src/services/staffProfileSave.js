const nullable = value => String(value ?? '').trim() || null;

export function staffProfilePayload(form, staff, storeId, staffId = staff?.id ?? null) {
  if (!nullable(form.name) || !nullable(form.lastName)) {
    throw new Error('Nombre y apellido son obligatorios.');
  }
  if (!storeId) throw new Error('No se pudo identificar la tienda. Vuelve a abrir el panel.');
  if (Boolean(nullable(form.modalityChangeDate)) !== Boolean(nullable(form.nextModality))) {
    throw new Error('La fecha y la nueva modalidad deben registrarse juntas.');
  }
  return {
    p_staff_id: staffId,
    p_store_id: storeId,
    p_first_name: form.name.trim(),
    p_last_name: form.lastName.trim(),
    p_email: nullable(form.email),
    p_dni: nullable(form.dni),
    p_gender: nullable(form.gender),
    // El modal no edita nacimiento: conservar el valor al actualizar.
    p_birth_date: nullable(staff?.birthDate),
    p_modality: nullable(form.modality),
    p_position: nullable(form.position) ?? 'COLABORADOR',
    p_status: staff?.status ?? 'pending',
    p_join_date: nullable(form.joinDate),
    p_sanitary_card_expiry: nullable(form.sanitaryCardDate),
    p_sanitary_card_unlock: Boolean(form.sanitaryCardUnlock),
    p_is_trainee: Boolean(form.isTrainee),
    p_training_end_date: form.isTrainee ? nullable(form.trainingEndDate) : null,
    p_modality_change_date: nullable(form.modalityChangeDate),
    p_next_modality: nullable(form.nextModality),
  };
}

export async function saveStaffFromModal(client, { form, staff, storeId, staffId, onProfileSaved }) {
  const { data: savedId, error } = await client.rpc(
    'save_staff_profile', staffProfilePayload(form, staff, storeId, staffId),
  );
  if (error) throw new Error(error.message || 'No se pudo guardar el colaborador.');
  if (!savedId) throw new Error('La base no devolvió el identificador del colaborador.');

  // Estas RPC no son un batch atómico. Conservar el ID confirmado permite
  // reintentar el cese sin insertar otro colaborador dentro del mismo modal.
  onProfileSaved(savedId);
  const cessationDate = form.isTrainee ? null : nullable(form.cessationDate);
  if (!form.isTrainee && cessationDate !== nullable(staff?.cessationDate)) {
    const { error: cessationError } = await client.rpc('save_staff_cessation', {
      p_staff_id: savedId,
      p_cessation_date: cessationDate,
    });
    if (cessationError) {
      throw new Error(`El perfil ya se guardó, pero no la fecha de cese: ${cessationError.message}. Puedes reintentar en este formulario sin crear otro perfil.`);
    }
  }
  return savedId;
}
