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
  const [needsStaffLink, setNeedsStaffLink] = useState(false);
  const [accessVersion, setAccessVersion] = useState(0);

  useEffect(() => {
    let active = true;

    const loadAccess = async (user) => {
      if (!active) return;
      if (!user) {
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        setNeedsStaffLink(false);
        setLoading(false);
        return;
      }

      setCurrentUser(compatibleUser(user));
      const fetchProfile = () => supabase
        .from("user_profiles")
        .select("id,email,first_name,last_name,role,status,store_id,staff_profile_id,registration_pending,staff_profiles(cessation_date)")
        .eq("id", user.id)
        .maybeSingle();

      let { data: profile, error } = await fetchProfile();
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      if (!active) return;
      const cessationDate = profile?.staff_profiles?.cessation_date;

      if (error) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setUserRole(null);
        setUserData(null);
        setNeedsStaffLink(false);
        setLoading(false);
        return;
      }

      const requiresStaffSelection = !profile
        || profile.status !== "active"
        || Boolean(cessationDate && today > cessationDate);
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
    };

    supabase.auth.getSession().then(({ data }) => loadAccess(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadAccess(session?.user ?? null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [accessVersion]);

  const refreshAccess = async () => {
    setLoading(true);
    setAccessVersion((version) => version + 1);
  };

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
    <AuthContext.Provider value={{ currentUser, userRole, userData, needsStaffLink, refreshAccess, login, logout, register, resetPassword, updatePassword }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}
