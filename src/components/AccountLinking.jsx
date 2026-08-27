import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase/client";
import background from "../assets/background.png";

const edgeError = async (error, data) => {
  const payload = error?.context
    ? await error.context.json().catch(() => null)
    : null;
  return payload?.error ?? data?.error ?? error?.message ?? "unknown_error";
};

const errorMessage = (code) => ({
  identity_mismatch: "El DNI no coincide con la ficha seleccionada.",
  staff_not_available: "La ficha ya no está disponible para vinculación.",
  account_already_linked: "Esta cuenta ya está vinculada. Recarga la página.",
  rate_limited: "Se alcanzó el límite de intentos. Espera unos minutos.",
  ambiguous_existing_account: "Hay más de una cuenta asociada. Solicita ayuda al administrador.",
}[code] ?? "No se pudo enlazar la cuenta. Verifica los datos o contacta al administrador.");

export default function AccountLinking() {
  const { currentUser, userRole, logout } = useAuth();
  const [stores, setStores] = useState([]);
  const [staff, setStaff] = useState([]);
  const [storeId, setStoreId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [dni, setDni] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!currentUser || userRole !== "registration") return;
    let active = true;
    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke("staff-account-admin", {
        body: { operation: "list_registration_stores" },
      });
      if (!active) return;
      if (invokeError || data?.error) setError(errorMessage(await edgeError(invokeError, data)));
      else {
        const nextStores = data?.stores ?? [];
        setStores(nextStores);
        setStoreId(nextStores[0]?.id ?? "");
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [currentUser, userRole]);

  useEffect(() => {
    if (!storeId || userRole !== "registration") { setStaff([]); setStaffId(""); return; }
    let active = true;
    setLoading(true);
    (async () => {
      const { data, error: invokeError } = await supabase.functions.invoke("staff-account-admin", {
        body: { operation: "list_registration_staff", storeId },
      });
      if (!active) return;
      if (invokeError || data?.error) setError(errorMessage(await edgeError(invokeError, data)));
      else {
        const nextStaff = data?.staff ?? [];
        setStaff(nextStaff);
        setStaffId(nextStaff[0]?.id ?? "");
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [storeId, userRole]);

  if (!currentUser) return <Navigate to="/login" replace />;
  if (userRole && userRole !== "registration") return <Navigate to="/" replace />;

  const claim = async (event) => {
    event.preventDefault();
    if (!staffId || !/^\d{6,15}$/.test(dni.replace(/\D/g, ""))) return;
    setSaving(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("staff-account-admin", {
      body: { operation: "claim_staff_account", staffId, dni: dni.replace(/\D/g, "") },
    });
    if (invokeError || data?.error || !data?.linked) {
      setError(errorMessage(await edgeError(invokeError, data)));
      setSaving(false);
      return;
    }
    window.location.assign("/");
  };

  return <div className="relative min-h-screen flex items-center justify-center bg-cover bg-center p-4" style={{ backgroundImage: `url(${background})` }}>
    <div className="absolute inset-0 bg-black/55" />
    <section className="relative z-10 w-full max-w-lg rounded-2xl border border-white/30 bg-white/95 p-7 shadow-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Enlaza tu ficha de colaborador</h1>
      <p className="mt-2 text-sm text-gray-600">Selecciona la tienda y tu ficha, luego confirma tu DNI. No se enlazará ninguna cuenta solo por coincidencia de nombre.</p>
      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!loading && stores.length === 0 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No hay fichas disponibles para este correo. Pide al administrador que registre tu ficha e invitación.</p>}
      <form className="mt-5 space-y-4" onSubmit={claim}>
        <label className="block text-sm font-semibold text-gray-700">Tienda
          <select className="mt-1 w-full rounded-lg border p-2" value={storeId} onChange={(event) => setStoreId(event.target.value)} disabled={loading || !stores.length}>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-gray-700">Colaborador
          <select className="mt-1 w-full rounded-lg border p-2" value={staffId} onChange={(event) => setStaffId(event.target.value)} disabled={loading || !staff.length}>
            {staff.map((person) => <option key={person.id} value={person.id}>{person.first_name} {person.last_name} · {person.position}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-gray-700">DNI
          <input className="mt-1 w-full rounded-lg border p-2" inputMode="numeric" autoComplete="off" value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, "").slice(0, 15))} minLength={6} required />
        </label>
        <button className="w-full rounded-lg bg-blue-600 p-3 font-bold text-white disabled:opacity-50" disabled={loading || saving || !staffId || dni.length < 6}>{saving ? "Validando…" : "Validar y enlazar"}</button>
      </form>
      <button className="mt-4 w-full text-sm text-gray-500 underline" type="button" onClick={() => logout()}>Cerrar sesión</button>
    </section>
  </div>;
}
