"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function PasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (password !== confirmation) { setError("Las contraseñas no coinciden."); return; }
    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) { setError("El enlace venció o no fue posible actualizar la contraseña."); setLoading(false); return; }
    router.replace("/portal"); router.refresh();
  }
  return <form onSubmit={submit} className="auth-form">
    {error && <p className="form-alert error">{error}</p>}
    <label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
    <label>Confirmar contraseña<input type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required /></label>
    <button className="primary-button" disabled={loading}>{loading ? "Guardando…" : "Guardar contraseña"}</button>
  </form>;
}
