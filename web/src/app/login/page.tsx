import { CalendarDays, ChartNoAxesCombined, ShieldCheck } from "lucide-react";
import { LoginForm } from "@/components/login-form";

export default function LoginPage() {
  return <main className="login-page">
    <section className="login-story">
      <span className="brand"><CalendarDays size={22} /> Horarios</span>
      <div><p className="eyebrow">OPERACIÓN EN TIEMPO REAL</p><h1>Personas, ventas y turnos en un solo lugar.</h1><p className="lead">La nueva plataforma conserva tus procesos y los conecta con una base PostgreSQL segura.</p></div>
      <div className="trust-row"><span><ShieldCheck size={18}/> Acceso con RLS</span><span><ChartNoAxesCombined size={18}/> Información consolidada</span></div>
    </section>
    <section className="login-panel"><div className="auth-card"><p className="eyebrow">BIENVENIDO</p><h2>Inicia sesión</h2><p className="muted">Los usuarios migrados deben crear su contraseña con “¿Olvidaste tu contraseña?”.</p><LoginForm /></div></section>
  </main>;
}
