const messages = {
  forbidden: 'Solo un superadmin activo puede realizar esta acción.',
  missing_session: 'Inicia sesión nuevamente para continuar.',
  invalid_session: 'Tu sesión venció. Inicia sesión nuevamente.',
  invalid_admin_details: 'Revisa el correo y la contraseña (mínimo 6 caracteres).',
  admin_not_found: 'No se encontró la cuenta de administrador. Actualiza la lista.',
  admin_list_failed: 'No se pudo cargar la lista de administradores.',
  admin_update_failed: 'No se pudieron guardar los cambios. Revisa el correo y la contraseña.',
  email_already_registered: 'Este correo ya pertenece a otra cuenta.',
  invalid_staff_id: 'El identificador del colaborador no es válido. Actualiza la página.',
  invalid_admin_id: 'El identificador del administrador no es válido. Actualiza la lista.',
  staff_not_found: 'El colaborador ya no existe. Actualiza la página.',
  staff_lookup_failed: 'No se pudo consultar el colaborador. Inténtalo nuevamente.',
  protected_account: 'Esta cuenta está protegida. Usa el directorio correspondiente; las cuentas de superadmin no se pueden eliminar.',
  account_link_conflict: 'La cuenta tiene vínculos inconsistentes con otros perfiles. No se realizó ningún cambio.',
  account_has_storage_objects: 'La cuenta tiene archivos asociados que deben retirarse antes de eliminarla. No se realizó ningún cambio.',
  account_has_shared_files: 'La cuenta es propietaria de firmas usadas en evaluaciones que deben conservarse. Es necesario reasignar esos archivos antes de eliminar el acceso; no se realizó ningún cambio.',
  staff_operation_failed: 'No se pudo completar la operación. No se guardaron cambios; inténtalo nuevamente.',
  staff_files_removal_failed: 'No se pudieron retirar todos los archivos. La cuenta y el perfil se conservaron; vuelve a intentar la operación.',
  staff_operation_after_files_failed: 'Se retiraron los archivos, pero la cuenta y el perfil no se eliminaron. Actualiza la página y vuelve a intentarlo.',
  rate_limited: 'Has realizado demasiados intentos. Espera unos minutos.',
  rate_limit_unavailable: 'El servicio no está disponible temporalmente. Inténtalo nuevamente.',
};

export async function invokeStaffAccountAdmin(client, body) {
  const { data, error } = await invokeAuthenticatedFunction(client, 'staff-account-admin', { body });
  if (error || data?.error) {
    let payload = data;
    if (error?.context?.json) {
      try { payload = await error.context.json(); } catch { /* Network errors may have no JSON body. */ }
    }
    throw new Error(messages[payload?.error] || 'No se pudo completar la operación de cuentas. Inténtalo nuevamente.');
  }
  return data;
}
import { invokeAuthenticatedFunction } from '../lib/supabase/invokeAuthenticatedFunction.js';
