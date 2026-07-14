"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    const { error: loginError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
    if (loginError) { setError("Credenciales incorrectas o contraseña aún no configurada."); setLoading(false); return; }
    router.replace("/portal"); router.refresh();
  }

  async function resetPassword() {
    if (!email.trim()) { setError("Ingresa tu correo primero."); return; }
    setLoading(true); setError("");
    const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
    const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    if (resetError) setError("No se pudo solicitar el restablecimiento.");
    else setNotice("Si el correo está registrado, recibirás un enlace para crear tu contraseña.");
  }

  return <form onSubmit={submit} className="auth-form">
    {error && <p className="form-alert error" role="alert">{error}</p>}
    {notice && <p className="form-alert success" role="status">{notice}</p>}
    <label>Correo electrónico<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    <button type="button" className="text-button" disabled={loading} onClick={resetPassword}>¿Olvidaste tu contraseña?</button>
    <button type="submit" className="primary-button" disabled={loading}>{loading ? "Validando…" : "Ingresar"}</button>
  </form>;
}
