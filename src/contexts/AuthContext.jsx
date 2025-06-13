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
        const docRef = doc(db, "users", user.uid); // <--- Buscar en 'users'
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
            setUserRole(data.role || null);
            setUserData(data); // <<-- Guardar todo el objeto de usuario
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


