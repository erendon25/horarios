import React, { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import background from "../assets/background.png";


function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
  if (success) {
    emailRef.current.value = "";
    passwordRef.current.value = "";
  }
}, [success]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    try {
    const userCredential = await register(emailRef.current.value, passwordRef.current.value);
    const user = userCredential.user; // mejor así, register probablemente devuelve userCredential

    await setDoc(doc(getFirestore(), "users", user.uid), {
      email: emailRef.current.value,
      role: "collaborator",
      createdAt: serverTimestamp(),
    });

    setSuccess(true);
    setTimeout(() => navigate("/login"), 2000);
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
  }
  // Añade esto para limpiar los campos después del éxito

};


  return (
    <div
      className="relative min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${background})`, backgroundSize: 'cover' }}
    >
      <div className="absolute inset-0 bg-black/50 z-0" />
      <div className="relative z-10 bg-white/20 backdrop-blur-lg p-8 rounded-xl shadow-lg max-w-md w-full text-white border border-white/30">
        <h2 className="text-3xl font-bold text-center mb-6">Registrar nuevo usuario</h2>
        {error && <p className="text-red-200 text-sm text-center mb-4">{error}</p>}
        {success && <p className="text-green-200 text-sm text-center mb-4">Registro exitoso. Redirigiendo...</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm">Correo Electrónico</label>
            <input
              id="email"
              type="email"
              required
              ref={emailRef}
              className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm">Contraseña</label>
            <input
              id="password"
              type="password"
              required
              ref={passwordRef}
              className="w-full p-2 rounded bg-white/30 text-black placeholder-gray-700"
            />
          </div>
          <button type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition">
            Registrarse
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          ¿Ya tienes cuenta? <a href="/login" className="underline text-blue-200">Inicia sesión</a>
        </p>
      </div>
    </div>
  );
}

export default Register;

