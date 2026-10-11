// Passwords are used only by the two authentication endpoints, never persisted.
export async function loginWithLegacyRecovery(client, email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  let result = await client.auth.signInWithPassword({ email: normalizedEmail, password });
  let pendingRecovery = false;
  if (!result.error && result.data?.user?.app_metadata?.legacy_staff_recovery_id) {
    // Auth creation can commit before the staff-link transaction finishes.
    // Resume it here before navigating to registration on the next attempt.
    const profile = await client.from('user_profiles')
      .select('status,registration_pending,staff_profile_id,store_id')
      .eq('id', result.data.user.id).maybeSingle();
    if (profile.error) throw profile.error;
    pendingRecovery = !profile.data || profile.data.registration_pending
      || !profile.data.staff_profile_id || !profile.data.store_id;
  }
  let legacyRecovered = false;
  if (result.error?.code === 'invalid_credentials' || pendingRecovery) {
    try {
      const recovery = await client.functions.invoke('recover-legacy-staff-login', {
        body: { email: normalizedEmail, password },
      });
      if (!recovery.error && recovery.data?.recovered === true) {
        result = await client.auth.signInWithPassword({ email: normalizedEmail, password });
        legacyRecovered = !result.error;
      }
    } catch {
      // Keep the original credential error; do not expose account existence.
    }
  }
  if (pendingRecovery && !legacyRecovered) {
    await client.auth.signOut();
    throw new Error('No se pudo completar la recuperación de acceso.');
  }
  if (result.error) throw result.error;
  return { ...result.data, legacyRecovered };
}
