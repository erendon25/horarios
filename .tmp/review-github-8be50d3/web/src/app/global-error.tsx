"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);

  return <html lang="es"><body><main className="center-page"><section className="auth-card"><p className="eyebrow">ERROR INESPERADO</p><h1>No pudimos completar la operación</h1><p className="muted">El incidente fue registrado. Puedes volver a intentarlo sin recargar toda la aplicación.</p><button className="primary-button" onClick={reset}>Intentar nuevamente</button></section></main></body></html>;
}
