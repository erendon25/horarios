import React, { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import background from "../assets/background.png";

function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pendingUser, setPendingUser] = useState(null);
  const [availableStaff, setAvailableStaff] = useState([]);
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const email = emailRef.current.value.trim();
      const userCredential = await register(email, passwordRef.current.value);
      const user = userCredential.user;
      const db = getFirestore();

      // Se crea primero la cuenta para consultar perfiles pendientes de forma
      // autenticada, sin publicar datos personales en las reglas de Firestore.
      await setDoc(doc(db, "users", user.uid), {
        email,
        role: "collaborator",
        registrationPending: true,
        createdAt: serverTimestamp(),
      });

      const snapshot = await getDocs(query(
        collection(db, "staff_profiles"),
        where("status", "==", "pending")
      ));
      const profiles = snapshot.docs
        .map((staffDoc) => ({ id: staffDoc.id, ...staffDoc.data() }))
        .filter((profile) => !profile.uid && !profile.cessationDate)
        .sort((a, b) =>
          `${a.name || ""} ${a.lastName || ""}`.localeCompare(
            `${b.name || ""} ${b.lastName || ""}`,
            "es"
          )
        );

      setPendingUser({ uid: user.uid, email });
      setAvailableStaff(profiles);
      if (profiles.length === 1) setSelectedStaffId(profiles[0].id);
    } catch (err) {
      console.error(err);
      if (err.code === "auth/email-already-in-use") {
        setError("Este correo ya está registrado. Intenta iniciar sesión o usa otro correo.");
      } else if (err.code === "auth/weak-password") {
        setError("La contraseña debe tener al menos 6 caracteres.");
      } else if (err.code === "auth/invalid-email") {
        setError("Correo electrónico inválido.");
      } else if (err.code === "permission-denied") {
        setError("Error de permisos en la base de datos. Contacta al administrador.");
      } else {
        setError("No se pudo completar el registro. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLinkStaff = async (event) => {
    event.preventDefault();
    if (!selectedStaffId || !pendingUser) {
      setError("Selecciona tu nombre para completar el registro.");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const db = getFirestore();
      const profile = availableStaff.find(({ id }) => id === selectedStaffId);
      if (!profile) throw new Error("El perfil seleccionado ya no está disponible.");

      const role = profile.position === "ENTRENADOR" ? "trainer" : "collaborator";
      await updateDoc(doc(db, "staff_profiles", profile.id), {
        uid: pendingUser.uid,
        email: pendingUser.email,
        status: "active",
        linkedAt: new Date().toISOString(),
      });
      await setDoc(doc(db, "users", pendingUser.uid), {
        email: pendingUser.email,
        role,
        storeId: profile.storeId,
        staffProfileId: profile.id,
        name: profile.name || "",
        lastName: profile.lastName || "",
        registrationPending: false,
      }, { merge: true });

      setSuccess(true);
      setTimeout(() => navigate("/login"), 2000);
    } catch (err) {
      console.error(err);
      setError(err.message || "No se pudo vincular el colaborador.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${background})`, backgroundSize: "cover" }}
    >
      <div className="absolute inset-0 bg-black/50 z-0" />
      <div className="relative z-10 bg-white/20 backdrop-blur-lg p-8 rounded-xl shadow-lg max-w-md w-full text-white border border-white/30">
        <h2 className="text-3xl font-bold text-center mb-6">
          {pendingUser ? "Selecciona tu nombre" : "Registrar nuevo usuario"}
        </h2>
        {error && <p className="text-red-200 text-sm text-center mb-4">{error}</p>}
        {success && <p className="text-green-200 text-sm text-center mb-4">Registro exitoso. Redirigiendo...</p>}

        {!pendingUser ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm">Correo electrónico</label>
              <input id="email" type="email" required ref={emailRef} className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm">Contraseña</label>
              <input id="password" type="password" required ref={passwordRef} className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700" />
            </div>
            <button disabled={loading} type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? "Buscando colaboradores..." : "Continuar"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleLinkStaff} className="space-y-4">
            <div>
              <label htmlFor="staffProfile" className="block text-sm mb-1">Colaborador</label>
              <select
                id="staffProfile"
                required
                value={selectedStaffId}
                onChange={(event) => setSelectedStaffId(event.target.value)}
                className="w-full p-2 rounded bg-white/80 text-black"
              >
                <option value="">— Selecciona tu nombre —</option>
                {availableStaff.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {`${profile.name || ""} ${profile.lastName || ""}`.trim()}
                    {profile.dni ? ` — DNI ${profile.dni}` : ""}
                  </option>
                ))}
              </select>
              {availableStaff.length === 0 && (
                <p className="text-yellow-200 text-sm mt-2">
                  No hay colaboradores pendientes de vinculación. Comunícate con tu administrador.
                </p>
              )}
            </div>
            <button disabled={loading || availableStaff.length === 0 || success} type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? "Vinculando..." : "Completar registro"}
            </button>
          </form>
        )}

        <p className="mt-4 text-center text-sm">
          ¿Ya tienes cuenta? <a href="/login" className="underline text-blue-200">Inicia sesión</a>
        </p>
      </div>
    </div>
  );
}

export default Register;
