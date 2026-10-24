import React, { useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client";
import { loginWithLegacyRecovery } from "../lib/supabase/loginWithLegacyRecovery";

const AuthContext = React.createContext();

export function useAuth() {
  return useContext(AuthContext);
}

const compatibleUser = (user) => user ? { ...user, uid: user.id } : null;

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);
  const [needsStaffLink, setNeedsStaffLink] = useState(false);
  const [accessVersion, setAccessVersion] = useState(0);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessError, setAccessError] = useState('');

  useEffect(() => {
    let active = true;
    let revision = 0;
    let loadedUserId = null;
    const timers = new Set();

    const loadAccess = async (user, requestRevision) => {
      const isCurrent = () => active && requestRevision === revision;
      if (!isCurrent()) return;
      if (!user) {
        loadedUserId = null;
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        setNeedsStaffLink(false);
        setLoading(false);
        setAccessLoading(false);
        setAccessError('');
        return;
      }

      setCurrentUser(compatibleUser(user));
      const fetchProfile = () => supabase
        .from("user_profiles")
        .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id,registration_pending,staff_profiles(cessation_date)")
        .eq("id", user.id)
        .maybeSingle();

      let profile, error;
      try {
        const result = await fetchProfile();
        profile = result.data;
        error = result.error;
      } catch (err) {
        error = err;
      }
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (!isCurrent()) return;
      const cessationDate = profile?.staff_profiles?.cessation_date;

      if (error) {
        setUserRole(null);
        setUserData(null);
        setNeedsStaffLink(false);
        setAccessError('No se pudo cargar tu acceso. Reintenta la conexión para continuar.');
        setLoading(false);
        setAccessLoading(false);
        return;
      }

      setAccessError('');
      if (['admin', 'superadmin'].includes(profile?.role) && profile.status !== 'active') {
        setUserRole(null);
        setUserData(null);
        setNeedsStaffLink(false);
        setAccessError('Tu acceso administrativo está inactivo. Contacta al responsable del sistema.');
        setLoading(false);
        setAccessLoading(false);
        return;
      }
      const staffRole = ['collaborator', 'trainer'].includes(profile?.role);
      const requiresStaffSelection = !profile
        || profile.status !== "active"
        || (staffRole
          && (profile.registration_pending || !profile.staff_profile_id || !profile.store_id))
        || (staffRole && Boolean(cessationDate && today > cessationDate));
      if (requiresStaffSelection) {
        // La cuenta Auth permanece iniciada para que un alta nueva o un
        // reingreso pueda elegir tienda y perfil laboral libre. El servidor
        // valida disponibilidad y DNI antes de mover cualquier vínculo.
        setUserRole(null);
        setUserData({
          id: user.id,
          uid: user.id,
          email: user.email,
          registrationPending: true,
        });
        setNeedsStaffLink(true);
        setLoading(false);
        setAccessLoading(false);
        loadedUserId = user.id;
        return;
      }

      const legacyShape = {
        id: profile.id,
        uid: profile.id,
        email: profile.email ?? user.email,
        name: profile.first_name ?? "",
        lastName: profile.last_name ?? "",
        role: profile.role,
        status: profile.status,
        storeId: profile.store_id,
        staffProfileId: profile.staff_profile_id,
        registrationPending: profile.registration_pending,
      };
      setUserRole(profile.role);
      setUserData(legacyShape);
      setNeedsStaffLink(false);
      setLoading(false);
      setAccessLoading(false);
      loadedUserId = user.id;
    };

    const queueAccess = (user) => {
      const requestRevision = ++revision;
      if (user?.id !== loadedUserId) setAccessLoading(true);
      // Finish Supabase's auth callback before making authenticated API calls.
      const timer = setTimeout(() => {
        timers.delete(timer);
        void loadAccess(user, requestRevision);
      }, 0);
      timers.add(timer);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      queueAccess(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (active && revision === 0) queueAccess(data.session?.user ?? null);
    }).catch(() => {
      if (active && revision === 0) {
        setAccessError('No se pudo recuperar tu sesión. Reintenta la conexión.');
        setLoading(false);
        setAccessLoading(false);
      }
    });

    return () => {
      active = false;
      timers.forEach(clearTimeout);
      listener.subscription.unsubscribe();
    };
  }, [accessVersion]);

  const refreshAccess = async () => {
    setAccessError('');
    setAccessLoading(true);
    setAccessVersion((version) => version + 1);
  };

  const login = async (email, password) => {
    setAccessLoading(true);
    let data;
    try {
      data = await loginWithLegacyRecovery(supabase, email, password);
    } catch (error) {
      setAccessLoading(false);
      throw error;
    }
    if (data.legacyRecovered) {
      setAccessLoading(true);
      // A partial Auth account may have loaded as unlinked before recovery.
      // Wait for its updated profile before Login chooses a destination.
      setNeedsStaffLink(false);
      setUserRole(null);
      setAccessVersion((version) => version + 1);
    }
    return { user: compatibleUser(data.user), session: data.session };
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const register = async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    return { user: compatibleUser(data.user), session: data.session };
  };

  const resetPassword = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
  };

  return (
    <AuthContext.Provider value={{ currentUser, userRole, userData, needsStaffLink, accessLoading, refreshAccess, login, logout, register, resetPassword, updatePassword }}>
      {!loading && (accessError ? <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md rounded-xl bg-white p-6 shadow space-y-4">
          <p role="alert">{accessError}</p>
          <button onClick={refreshAccess} className="rounded-lg bg-blue-600 px-4 py-2 text-white">Reintentar</button>
          <button onClick={() => logout().catch(() => setAccessError('No se pudo cerrar la sesión. Reintenta.'))} className="ml-3 rounded-lg border px-4 py-2">Cerrar sesión</button>
        </div>
      </div> : children)}
    </AuthContext.Provider>
  );
}
