import { CalendarDays, ChartNoAxesCombined, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { LoginForm } from "@/components/login-form";

const accessMessages: Record<string, string> = {
  cessation: "Tu acceso está suspendido porque el cese ya es efectivo.",
  inactive: "Tu cuenta está inactiva. Solicita a un administrador que revise tu estado.",
  inactive_store: "La tienda asignada a tu cuenta está inactiva. Solicita que revisen tu asignación antes de volver a ingresar.",
  registration: "Tu cuenta aún no tiene un vínculo válido con un colaborador. Solicita que registren este mismo correo en tu ficha y completa el enlace desde el portal principal.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const reason = (await searchParams).reason ?? "";
  return <main className="login-page">
    <section className="login-story">
      <div className="login-brand"><span className="brand-mark"><CalendarDays size={22}/></span><span><strong>Horarios</strong><small>Operations workspace</small></span></div>
      <div className="login-message"><span className="login-kicker"><Sparkles size={15}/> NUEVA EXPERIENCIA OPERATIVA</span><h1>Tu operación, coordinada de principio a fin.</h1><p className="lead">Gestiona personas, ventas y turnos desde un espacio seguro, claro y conectado.</p><div className="login-benefits"><span><CheckCircle2/>Planificación semanal</span><span><CheckCircle2/>Indicadores en contexto</span><span><CheckCircle2/>Acceso por responsabilidades</span></div></div>
      <div className="trust-row"><span><ShieldCheck size={18}/> Datos protegidos por rol</span><span><ChartNoAxesCombined size={18}/> Información consolidada</span></div>
    </section>
    <section className="login-panel"><div className="auth-card"><div className="auth-card-heading"><span>ACCESO SEGURO</span><h2>Bienvenido de nuevo</h2><p>Ingresa con tu cuenta para continuar a tu espacio de trabajo.</p></div>{accessMessages[reason] && <p className="form-alert warning" role="status">{accessMessages[reason]}</p>}<LoginForm /><p className="migration-help">¿Es tu primer ingreso después de la migración? Usa <strong>¿Olvidaste tu contraseña?</strong></p></div><footer>Plataforma interna de operaciones</footer></section>
  </main>;
}
