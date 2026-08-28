export function withCanonicalStaffIdentity(row, mappedProfile = {}) {
  return {
    ...mappedProfile,
    // legacy_data puede contener su antiguo campo `id`. El UUID de la fila
    // canónica siempre debe ganar para cualquier edición posterior.
    id: row?.id ?? null,
    firestoreId: row?.firestore_id ?? null,
  };
}
