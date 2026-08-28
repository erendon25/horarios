import React, { useContext, useEffect, useState } from "react";
import { supabase } from "../lib/supabase/client";

const AuthContext = React.createContext();
const publicAppUrl = (import.meta.env.VITE_APP_URL || "https://lc-scheduler.web.app").replace(/\/$/, "");

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
      let trainingEndDate = null;
      let isTrainee = false;
      let staffLinkValid = true;
      let hasStaffProfile = false;
      let storeIsActive = profile?.role === "superadmin";
      if (!error && profile?.store_id) {
        const store = await supabase
          .from("stores")
          .select("is_active")
          .eq("id", profile.store_id)
          .maybeSingle();
        if (store.error) error = store.error;
        storeIsActive = Boolean(store.data?.is_active);
      }
      if (!error && profile?.staff_profile_id) {
        const staff = await supabase
          .from("staff_profiles")
          .select("id,user_id,store_id,cessation_date,is_trainee,training_end_date")
          .eq("id", profile.staff_profile_id)
          .maybeSingle();
        if (staff.error) error = staff.error;
        cessationDate = staff.data?.cessation_date ?? null;
        trainingEndDate = staff.data?.training_end_date ?? null;
        isTrainee = Boolean(staff.data?.is_trainee);
        hasStaffProfile = Boolean(staff.data);
        staffLinkValid = Boolean(
          staff.data
          && staff.data.user_id === profile.id
          && staff.data.store_id === profile.store_id
        );
      }

      if (!active || requestId !== accessRequest) return;
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const trainingEnded = Boolean(isTrainee && trainingEndDate && today > trainingEndDate);

      if (error) {
        console.error("No se pudo validar el perfil de acceso:", error);
        setAccessError("No se pudo validar tu acceso en Supabase. Reintenta sin volver a iniciar sesión.");
        setLoading(false);
        return;
      }

      const isCollaborator = Boolean(profile && ["collaborator", "trainer"].includes(profile.role));
      const hasCompleteStaffLink = Boolean(
        isCollaborator
        && profile.staff_profile_id
        && profile.store_id
        && hasStaffProfile
        && staffLinkValid
      );

      // Una ficha ya vinculada nunca debe volver al selector de DNI. Si solo
      // quedó una marca pendiente obsoleta, el servidor valida el vínculo
      // canónico y la corrige antes de habilitar el portal.
      if (hasCompleteStaffLink
        && profile.registration_pending
        && profile.status === "active"
        && storeIsActive
        && !(cessationDate && today > cessationDate)
        && !trainingEnded) {
        const recovery = await supabase.functions.invoke("staff-account-admin", {
          body: { operation: "recover_existing_staff_link" },
        });
        if (recovery.error || !recovery.data?.recovered) {
          error = recovery.error ?? new Error("No se pudo reparar el vínculo existente.");
        } else {
          profile = { ...profile, registration_pending: false };
        }
      }

      if (!active || requestId !== accessRequest) return;
      if (error) {
        console.error("No se pudo recuperar el vínculo de colaborador:", error);
        setAccessError("Tu ficha ya está vinculada, pero no se pudo validar el acceso. Reintenta en unos segundos.");
        setLoading(false);
        return;
      }

      const collaboratorNeedsLink = !profile
        || (isCollaborator
          && (
            !profile.staff_profile_id
            || !profile.store_id
            || !hasStaffProfile
            || !staffLinkValid
          ));
      if (collaboratorNeedsLink) {
        setUserRole("registration");
        setUserData({
          id: user.id,
          uid: user.id,
          email: profile?.email ?? user.email,
          role: "registration",
          registrationPending: true,
        });
        setAccessError(null);
        setLoading(false);
        return;
      }

      if (!profile || profile.status !== "active" || !storeIsActive || (cessationDate && today > cessationDate) || trainingEnded) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        if (trainingEnded) {
          alert("Tu etapa de entrenamiento ya finalizó. Solicita una nueva ficha si inicia otro vínculo laboral.");
        } else if (cessationDate && today > cessationDate) {
          alert("Tu acceso ha sido revocado debido al cese de actividades.");
        } else if (profile && !storeIsActive) {
          alert("Tu tienda está inactiva. Solicita a un administrador que revise tu asignación.");
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase puede volver al Site URL cuando /update-password no está en
      // la lista de redirecciones permitidas. El evento es la fuente fiable
      // para abrir siempre la pantalla correcta de recuperación.
      if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/update-password") {
        window.location.replace("/update-password");
        return;
      }
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
      // La recuperación siempre pertenece al sitio publicado. Así, incluso si
      // alguien conserva abierto el proyecto local, el correo nunca apunta a localhost.
      redirectTo: `${publicAppUrl}/update-password`,
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
