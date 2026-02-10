// src/contexts/AuthContext.jsx
import React, { useContext, useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";

const AuthContext = React.createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const auth = getAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);

      if (user) {
        const db = getFirestore();
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();

          // Check for termination in staff_profiles
          try {
            const { collection, query, where, getDocs } = await import("firebase/firestore"); // Dynamic import to avoid top-level changes if possible, or just add imports
            const staffQuery = query(collection(db, "staff_profiles"), where("uid", "==", user.uid));
            const staffSnap = await getDocs(staffQuery);

            if (!staffSnap.empty) {
              const staffData = staffSnap.docs[0].data();
              if (staffData.terminationDate) {
                // Normalizamos fecha actual a YYYY-MM-DD local
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const todayStr = `${year}-${month}-${day}`;

                // Asegurar formato YYYY-MM-DD para la fecha guardada
                const [tY, tM, tD] = staffData.terminationDate.split('-').map(Number);
                const termStr = `${tY}-${String(tM).padStart(2, '0')}-${String(tD).padStart(2, '0')}`;

                // Si hoy es estrictamente MAYOR que la fecha de cese, bloquear.
                // Ejemplo: Hoy=2024-02-09, Cese=2024-02-08 -> '2024-02-09' > '2024-02-08' -> TRUE (Bloqueado)
                // Ejemplo: Hoy=2024-02-08, Cese=2024-02-08 -> FALSE (Permitido)
                if (todayStr > termStr) {
                  console.log(`Usuario cesado. Fecha cese: ${termStr}, Hoy: ${todayStr}. Cerrando sesión...`);
                  await signOut(auth);
                  alert("Tu acceso ha sido revocado debido a cese de actividades.");
                  setUserRole(null);
                  setUserData(null);
                  setLoading(false);
                  return;
                }
              }
            }
          } catch (err) {
            console.error("Error verificando cese:", err);
          }

          setUserRole(data.role || null);
          setUserData(data);
        } else {
          console.log("No se encontró el documento del usuario.");
          setUserRole(null);
          setUserData(null);
        }
      } else {
        setUserRole(null);
        setUserData(null);
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const login = (email, password) => {
    const auth = getAuth();
    return signInWithEmailAndPassword(auth, email, password);
  };

  const logout = () => {
    const auth = getAuth();
    return signOut(auth);
  };

  const register = (email, password) => {
    const auth = getAuth();
    return createUserWithEmailAndPassword(auth, email, password);
  };

  const value = {
    currentUser,
    userRole,
    userData, // <<-- Nuevo campo en el contexto
    login,
    logout,
    register,
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}


