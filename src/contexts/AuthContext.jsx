// src/contexts/AuthContext.jsx
import React, { useContext, useEffect, useState } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "firebase/auth";
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
      try {
        setCurrentUser(user);

        if (user) {
          const db = getFirestore();
          const docRef = doc(db, "users", user.uid);
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
            const data = docSnap.data();

            // Check for termination in staff_profiles
            try {
              const { collection, query, where, getDocs } = await import("firebase/firestore");
              const staffQuery = query(collection(db, "staff_profiles"), where("uid", "==", user.uid));
              const staffSnap = await getDocs(staffQuery);

              if (!staffSnap.empty) {
                const staffData = staffSnap.docs[0].data();
                if (staffData.cessationDate) {
                  const now = new Date();
                  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                  const cessationDate = staffData.cessationDate.split('T')[0]; // Format YYYY-MM-DD

                  if (todayStr > cessationDate) {
                    console.log(`Usuario cesado. Cerrando sesión...`);
                    await signOut(auth);
                    alert("Tu acceso ha sido revocado debido a cese de actividades.");
                    setUserRole(null);
                    setUserData(null);
                    return;
                  }
                }
              }
            } catch (err) {
              if (err.name !== 'AbortError') {
                console.error("Error verificando cese:", err);
              }
            }

            setUserRole(data.role || null);
            setUserData(data);
          } else {
            console.log("No se encontró el documento del usuario. Asignando rol 'collaborator'.");
            setUserRole('collaborator');
            setUserData({ role: 'collaborator', email: user.email });
          }
        } else {
          setUserRole(null);
          setUserData(null);
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error("Auth state update error:", error);
        }
      } finally {
        setLoading(false);
      }
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

  const resetPassword = (email) => {
    const auth = getAuth();
    return sendPasswordResetEmail(auth, email);
  };

  const value = {
    currentUser,
    userRole,
    userData, // <<-- Nuevo campo en el contexto
    login,
    logout,
    register,
    resetPassword,
  };

  return <AuthContext.Provider value={value}>{!loading && children}</AuthContext.Provider>;
}


