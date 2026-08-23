import React, { useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client";

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
  const [accessError, setAccessError] = useState(null);

  useEffect(() => {
    let active = true;
    let accessRequest = 0;

    const loadAccess = async (user) => {
      const requestId = ++accessRequest;
      if (!active) return;
      if (!user) {
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        setAccessError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setAccessError(null);
      setCurrentUser(compatibleUser(user));
      const readProfile = () => supabase
          .from("user_profiles")
          .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id,registration_pending")
          .eq("id", user.id)
          .maybeSingle();

      let { data: profile, error } = await readProfile();

      if (!profile && user.email) {
        const link = await supabase.functions.invoke("staff-account-admin", {
          body: { operation: "register_staff_by_email" },
        });
        if (!link.error) {
          const retry = await readProfile();
          profile = retry.data;
          error = retry.error;
        }
      }

      // La restauración de sesión y SIGNED_IN pueden coincidir. Reintenta una
      // lectura transitoria, pero nunca cierres una sesión válida por ese error.
      if (error) {
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        const retry = await readProfile();
        profile = retry.data;
        error = retry.error;
      }

      if (!active || requestId !== accessRequest) return;
      let cessationDate = null;
      if (!error && profile?.staff_profile_id) {
        const staff = await supabase
          .from("staff_profiles")
          .select("cessation_date")
          .eq("id", profile.staff_profile_id)
          .maybeSingle();
        if (staff.error) error = staff.error;
        cessationDate = staff.data?.cessation_date ?? null;
      }

      if (!active || requestId !== accessRequest) return;
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      if (error) {
        console.error("No se pudo validar el perfil de acceso:", error);
        setAccessError("No se pudo validar tu acceso en Supabase. Reintenta sin volver a iniciar sesión.");
        setLoading(false);
        return;
      }

      if (!profile || profile.status !== "active" || (cessationDate && today > cessationDate)) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        if (cessationDate && today > cessationDate) {
          alert("Tu acceso ha sido revocado debido al cese de actividades.");
        }
        setLoading(false);
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
      setAccessError(null);
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => loadAccess(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // Supabase recomienda diferir operaciones asíncronas iniciadas desde este callback.
      window.setTimeout(() => void loadAccess(session?.user ?? null), 0);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
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
    <AuthContext.Provider value={{ currentUser, userRole, userData, login, logout, register, resetPassword, updatePassword }}>
      {!loading && accessError && (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "1.5rem", background: "#f8fafc" }}>
          <section style={{ maxWidth: 460, padding: "1.5rem", borderRadius: 16, background: "white", boxShadow: "0 12px 40px #1018281f", textAlign: "center" }}>
            <h2 style={{ marginBottom: ".6rem" }}>No pudimos cargar tu acceso</h2>
            <p style={{ color: "#475467" }}>{accessError}</p>
            <button type="button" onClick={() => window.location.reload()} style={{ marginTop: "1rem", padding: ".75rem 1rem", border: 0, borderRadius: 10, color: "white", background: "#2563eb", fontWeight: 700, cursor: "pointer" }}>Reintentar</button>
          </section>
        </main>
      )}
      {!loading && !accessError && children}
    </AuthContext.Provider>
  );
}
