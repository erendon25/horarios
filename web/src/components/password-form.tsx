"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      setError("El enlace no creó una sesión de recuperación. Solicita uno nuevo y ábrelo en este mismo navegador.");
      setLoading(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) { setError("El enlace venció o no fue posible actualizar la contraseña."); setLoading(false); return; }
    window.location.assign("/portal");
  }
  return <form onSubmit={submit} className="auth-form">
    {error && <p className="form-alert error">{error}</p>}
    <label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
    <label>Confirmar contraseña<input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></label>
    <button className="primary-button" disabled={loading}>{loading ? "Guardando…" : "Guardar contraseña"}</button>
  </form>;
}
