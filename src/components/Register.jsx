import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase/client";
import background from "../assets/background.png";

function Register() {
  const emailRef = useRef();
  const passwordRef = useRef();
  const { currentUser, userRole, needsStaffLink, refreshAccess, register, logout } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [stores, setStores] = useState([]);
  const [staff, setStaff] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [dni, setDni] = useState("");

  useEffect(() => {
    if (!currentUser || needsStaffLink || !userRole) return;
    navigate(["admin", "superadmin"].includes(userRole) ? `/${userRole}` : "/staff", { replace: true });
  }, [currentUser, needsStaffLink, userRole, navigate]);

  useEffect(() => {
    if (!currentUser || !needsStaffLink) return;
    let active = true;
    setLoading(true);
    setError("");
    supabase.functions.invoke("staff-account-admin", {
      body: { operation: "list_registration_stores" },
    }).then(({ data, error: requestError }) => {
      if (!active) return;
      if (requestError) {
        setError("No se pudieron consultar las tiendas disponibles. Intenta nuevamente.");
        return;
      }
      setStores(data?.stores ?? []);
      if ((data?.stores ?? []).length === 1) setStoreId(data.stores[0].id);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [currentUser, needsStaffLink]);

  useEffect(() => {
    if (!currentUser || !needsStaffLink || !storeId) {
      setStaff([]);
      setStaffId("");
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    supabase.functions.invoke("staff-account-admin", {
      body: { operation: "list_registration_staff", storeId },
    }).then(({ data, error: requestError }) => {
      if (!active) return;
      if (requestError) {
        setError("No se pudieron consultar los colaboradores libres de esta tienda.");
        return;
      }
      const available = data?.staff ?? [];
      setStaff(available);
      setStaffId(available.length === 1 ? available[0].id : "");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [currentUser, needsStaffLink, storeId]);

  const handleCreateAccount = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setLoading(true);
    try {
      const email = emailRef.current.value.trim().toLowerCase();
      const credential = await register(email, passwordRef.current.value);
      if (credential.session) {
        setMessage("Cuenta creada. Ahora selecciona tu tienda y tu nombre para completar el registro.");
      } else {
        setMessage("Revisa tu correo para confirmar la cuenta. Luego inicia sesión para elegir tu tienda y tu perfil.");
      }
    } catch (err) {
      console.error(err);
      const text = String(err.message ?? "").toLowerCase();
      if (text.includes("already") || text.includes("registered")) setError("Este correo ya está registrado. Inicia sesión para completar el enlace.");
      else if (text.includes("password")) setError("La contraseña no cumple los requisitos de seguridad.");
      else setError("No se pudo crear la cuenta. Verifica los datos e intenta nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleClaimStaff = async (event) => {
    event.preventDefault();
    if (!storeId || !staffId || !dni.trim()) {
      setError("Selecciona tu tienda, tu nombre e ingresa tu DNI.");
      return;
    }
    setError("");
    setMessage("");
    setLoading(true);
    const { data, error: requestError } = await supabase.functions.invoke("staff-account-admin", {
      body: { operation: "claim_staff_account", staffId, dni },
    });
    if (requestError || !data?.linked) {
      const status = requestError?.context?.status;
      setError(status === 403
        ? "El DNI no coincide con el colaborador seleccionado. Verifica tu selección."
        : "No se pudo completar el enlace. El colaborador puede haber sido vinculado por otra cuenta.");
      setLoading(false);
      return;
    }

    setMessage(data.reactivated
      ? "Reingreso vinculado correctamente. Recuperamos tu cuenta y mantuvimos tu historial anterior."
      : "Registro completado correctamente.");
    await refreshAccess();
    setTimeout(() => navigate("/staff", { replace: true }), 500);
  };

  const handleChangeAccount = async () => {
    setLoading(true);
    await logout().catch(() => {});
    navigate("/login", { replace: true });
  };

  const inputClass = "w-full p-2 rounded bg-white/80 text-black";
  const linking = Boolean(currentUser && needsStaffLink);

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${background})`, backgroundSize: "cover" }}>
      <div className="absolute inset-0 bg-black/50 z-0" />
      <div className="relative z-10 bg-white/20 backdrop-blur-lg p-8 rounded-xl shadow-lg max-w-md w-full text-white border border-white/30">
        <h2 className="text-3xl font-bold text-center mb-6">{linking ? "Completar registro" : "Registrar cuenta"}</h2>
        {error && <p className="text-red-200 text-sm text-center mb-4" role="alert">{error}</p>}
        {message && <p className="text-green-200 text-sm text-center mb-4" role="status">{message}</p>}

        {!linking ? (
          <form onSubmit={handleCreateAccount} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm">Correo electrónico</label>
              <input id="email" type="email" autoComplete="email" required ref={emailRef} className={inputClass} />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm">Contraseña</label>
              <input id="password" type="password" autoComplete="new-password" minLength={8} required ref={passwordRef} className={inputClass} />
            </div>
            <button disabled={loading || Boolean(message)} type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? "Creando cuenta..." : "Continuar"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleClaimStaff} className="space-y-4">
            <p className="text-sm text-blue-100">Sesión: <strong>{currentUser.email}</strong></p>
            <div>
              <label htmlFor="store" className="block text-sm">Tienda</label>
              <select id="store" required value={storeId} onChange={(event) => setStoreId(event.target.value)} className={inputClass}>
                <option value="">— Selecciona tu tienda —</option>
                {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="staff" className="block text-sm">Colaborador libre</label>
              <select id="staff" required disabled={!storeId || loading} value={staffId} onChange={(event) => setStaffId(event.target.value)} className={inputClass}>
                <option value="">— Selecciona tu nombre —</option>
                {staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {[person.first_name, person.last_name].filter(Boolean).join(" ")}{person.position ? ` — ${person.position}` : ""}
                  </option>
                ))}
              </select>
              {storeId && !loading && staff.length === 0 && <p className="text-yellow-200 text-xs mt-2">No hay colaboradores pendientes en esta tienda.</p>}
            </div>
            <div>
              <label htmlFor="dni" className="block text-sm">DNI de verificación</label>
              <input id="dni" type="text" inputMode="numeric" autoComplete="off" required minLength={6} maxLength={15} value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, ""))} className={inputClass} />
              <p className="text-xs text-blue-100 mt-1">El DNI evita que otra persona pueda escoger tu nombre.</p>
            </div>
            <button disabled={loading || !staffId} type="submit" className="w-full p-2 rounded bg-blue-600 hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? "Vinculando..." : "Completar registro"}
            </button>
            <button type="button" disabled={loading} onClick={handleChangeAccount} className="w-full text-sm underline text-blue-200 disabled:opacity-50">Usar otra cuenta</button>
          </form>
        )}

        {!linking && <p className="mt-4 text-center text-sm">¿Ya tienes cuenta? <a href="/login" className="underline text-blue-200">Inicia sesión</a></p>}
      </div>
    </div>
  );
}

export default Register;
