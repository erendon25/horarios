"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const rememberedAccountKey = "horarios:remembered-account";
const rememberedAccount = () => typeof window === "undefined" ? "" : window.localStorage.getItem(rememberedAccountKey) ?? "";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState(rememberedAccount);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [rememberAccount, setRememberAccount] = useState(() => Boolean(rememberedAccount()));
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError(""); setNotice("");
    const normalizedEmail = email.trim().toLocaleLowerCase("es");
    const { error: loginError } = await createClient().auth.signInWithPassword({ email: normalizedEmail, password });
    if (loginError) { setError("Credenciales incorrectas o contraseña aún no configurada."); setLoading(false); return; }
    if (rememberAccount) window.localStorage.setItem(rememberedAccountKey, normalizedEmail);
    else window.localStorage.removeItem(rememberedAccountKey);
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
    <label>Correo electrónico<div className="auth-input"><Mail size={18}/><input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" /></div></label>
    <label>Contraseña<div className="auth-input"><LockKeyhole size={18}/><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Ingresa tu contraseña"/><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
    <div className="auth-options"><label className="remember-account"><input type="checkbox" checked={rememberAccount} onChange={(event) => setRememberAccount(event.target.checked)}/><span>Recordar cuenta</span></label><button type="button" className="text-button" disabled={loading} onClick={resetPassword}>¿Olvidaste tu contraseña?</button></div>
    <button type="submit" className="primary-button" disabled={loading}>{loading ? "Validando…" : "Ingresar"}</button>
    <p className="auth-security-note">Tu contraseña nunca se guarda en este dispositivo.</p>
  </form>;
}
