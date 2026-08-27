import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import background from "../assets/background.png";

function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const email = emailRef.current.value.trim().toLowerCase();
      const credential = await register(email, passwordRef.current.value);
      if (credential.session) {
        setMessage("Cuenta creada. Ahora valida tu identidad para enlazarla con tu ficha de colaborador.");
        setTimeout(() => navigate("/link-account"), 1200);
      } else {
        setMessage("Revisa tu correo para confirmar la cuenta. Al iniciar sesión podrás validar tu identidad y enlazar tu ficha de colaborador.");
      }
    } catch (err) {
      console.error(err);
      const text = String(err.message ?? "").toLowerCase();
      if (text.includes("already") || text.includes("registered")) setError("Este correo ya está registrado. Intenta iniciar sesión.");
      else if (text.includes("password")) setError("La contraseña debe tener al menos 6 caracteres.");
      else setError("No se pudo crear la cuenta. Verifica el correo, inténtalo nuevamente o contacta al administrador.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${background})`, backgroundSize: "cover" }}>
      <div className="absolute inset-0 bg-black/50 z-0" />
      <div className="relative z-10 bg-white/20 backdrop-blur-lg p-8 rounded-xl shadow-lg max-w-md w-full text-white border border-white/30">
        <h2 className="text-3xl font-bold text-center mb-6">Registrar cuenta</h2>
        {error && <p className="text-red-200 text-sm text-center mb-4">{error}</p>}
        {message && <p className="text-green-200 text-sm text-center mb-4">{message}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm">Correo electrónico</label>
            <input id="email" type="email" required ref={emailRef} className="w-full p-2 rounded bg-white/80 text-black" />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm">Contraseña</label>
            <input id="password" type="password" minLength={6} required ref={passwordRef} className="w-full p-2 rounded bg-white/80 text-black" />
          </div>
          <button disabled={loading || Boolean(message)} type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
            {loading ? "Creando cuenta..." : "Registrarme"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">¿Ya tienes cuenta? <a href="/login" className="underline text-blue-200">Inicia sesión</a></p>
      </div>
    </div>
  );
}

export default Register;
