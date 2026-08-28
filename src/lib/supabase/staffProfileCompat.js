export function withCanonicalStaffIdentity(row, mappedProfile = {}) {
  return {
    ...mappedProfile,
    // El UUID de Supabase es la única identidad válida del colaborador.
    id: row?.id ?? null,
  };
}
