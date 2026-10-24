import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { supabase } from '../lib/supabase/client';
import { invokeStaffAccountAdmin } from '../services/staffAccountAdmin';

export default function AdminAccountsPanel({ refreshKey = 0, onDeleted }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const loadAdmins = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await invokeStaffAccountAdmin(supabase, { operation: 'list_admins' });
      setAdmins(data.admins);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAdmins(); }, [loadAdmins, refreshKey]);

  const startEditing = (admin) => {
    setEditing(admin.id);
    setEmail(admin.email || '');
    setPassword('');
  };
  const cancelEditing = () => { setEditing(null); setEmail(''); setPassword(''); };
  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result = await invokeStaffAccountAdmin(supabase, {
        operation: 'update_admin', userId: editing, email: email.trim().toLowerCase(),
        ...(password ? { password } : {}),
      });
      setAdmins((previous) => previous.map((admin) => admin.id === editing ? { ...admin, email: result.email } : admin));
      cancelEditing();
      toast.success('Datos de acceso del administrador actualizados');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteAdmin = async (admin) => {
    if (saving) return;
    if (!window.confirm(`¿Eliminar definitivamente al administrador ${admin.email}?\n\nSe borrarán su cuenta de acceso, perfil administrativo y archivos personales. Su tienda y los registros de trabajo se conservarán. Esta acción no se puede deshacer.`)) return;
    setSaving(true);
    try {
      await invokeStaffAccountAdmin(supabase, { operation: 'delete_admin', userId: admin.id });
      setAdmins((previous) => previous.filter((item) => item.id !== admin.id));
      if (editing === admin.id) cancelEditing();
      toast.success('Administrador y cuenta de acceso eliminados definitivamente');
      onDeleted?.(admin.id);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const searchText = search.trim().toLowerCase();
  const filtered = admins.filter((admin) => !searchText || [admin.email, admin.first_name, admin.last_name, admin.stores?.name]
    .some((value) => value?.toLowerCase().includes(searchText)));

  return (
    <section className="bg-white rounded-2xl shadow border border-gray-100 p-6" aria-labelledby="admin-accounts-title">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h2 id="admin-accounts-title" className="text-xl font-bold text-purple-700">Administradores registrados ({admins.length})</h2>
        <button type="button" onClick={loadAdmins} disabled={loading || saving} className="px-4 py-2 border rounded-lg text-sm disabled:opacity-50">Actualizar lista</button>
      </div>
      <label htmlFor="admin-search" className="block text-sm font-medium mb-1">Buscar por correo, nombre o tienda</label>
      <input id="admin-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full px-3 py-2 border rounded-lg mb-4" />
      {loading ? <p role="status">Cargando administradores…</p> : error ? <p role="alert" className="text-red-700">{error}</p> : (
        <div className="space-y-3">
          {filtered.map((admin) => (
            <article key={admin.id} className="border rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold break-all">{admin.email || 'Sin correo'}</h3>
                  <p className="text-sm text-gray-600">{admin.stores?.name || 'Sin tienda asignada'}{admin.stores?.is_active === false ? ' · Tienda inactiva' : ''}</p>
                  <p className="text-xs text-gray-500">Estado: {({ active: 'Activo', inactive: 'Inactivo', pending: 'Pendiente' })[admin.status] || admin.status}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => startEditing(admin)} disabled={saving} className="px-3 py-2 text-sm font-semibold text-purple-700 bg-purple-50 rounded-lg disabled:opacity-50">Editar acceso</button>
                  <button type="button" onClick={() => deleteAdmin(admin)} disabled={saving} className="px-3 py-2 text-sm font-semibold text-red-700 bg-red-50 rounded-lg disabled:opacity-50">Eliminar administrador</button>
                </div>
              </div>
              {editing === admin.id && (
                <form onSubmit={save} className="mt-4 space-y-3 border-t pt-4">
                  <label className="block text-sm font-medium">Correo electrónico
                    <input type="email" autoComplete="off" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={saving} className="mt-1 block w-full px-3 py-2 border rounded-lg" />
                  </label>
                  <label className="block text-sm font-medium">Nueva contraseña
                    <input type="password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} aria-describedby="admin-password-help" className="mt-1 block w-full px-3 py-2 border rounded-lg" />
                  </label>
                  <p id="admin-password-help" className="text-xs text-gray-500">Déjala vacía para conservar la contraseña actual. Mínimo 6 caracteres para cambiarla.</p>
                  <div className="flex gap-3">
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar acceso'}</button>
                    <button type="button" disabled={saving} onClick={cancelEditing} className="px-4 py-2 border rounded-lg disabled:opacity-50">Cancelar</button>
                  </div>
                </form>
              )}
            </article>
          ))}
          {filtered.length === 0 && <p className="text-gray-500">{admins.length ? 'No hay administradores que coincidan con la búsqueda.' : 'Aún no hay administradores registrados.'}</p>}
        </div>
      )}
    </section>
  );
}
