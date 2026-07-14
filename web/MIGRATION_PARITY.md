# Matriz de paridad Firebase → Next.js + Supabase

Esta matriz evita retirar la aplicación actual hasta comprobar cada flujo en paralelo.

| Área | Ruta anterior | Ruta Next.js | Estado | Regla protegida |
| --- | --- | --- | --- | --- |
| Inicio de sesión | `/login` | `/login` | Implementado | Supabase Auth, sin excepción por correo |
| Recuperar contraseña | `/login` | `/login` + `/update-password` | Implementado | PKCE y callback validado |
| Acceso por rol | varias | `/portal` | Implementado | Perfil PostgreSQL + RLS |
| Cese de colaborador | `AuthContext` | layout protegido | Implementado | Revoca desde el día posterior, igual que hoy |
| Superadmin | `/superadmin` | `/superadmin` | Resumen y horario por tienda implementados | Solo rol `superadmin` |
| Administración | `/admin` | `/admin` | Colaboradores y RR. HH. implementados | Tienda del perfil + RLS |
| Colaborador | `/staff` | `/staff` | Perfil, horario, estudios, extras, feriados y solicitudes implementados | Usuario vinculado + RLS por fila |
| Estudios | `/admin/study*`, `/staff/study` | `/admin`, `/staff`, `/training` | Implementado | 7 días, bloques, día libre, carnet y bloqueo temporal |
| Horarios | `/horarios`, generación | `/admin`, `/superadmin` | Editor, generación, mapa de cobertura y exportaciones implementados | Guardado atómico, tienda, estudios, habilidades, relevos, turnos nocturnos/partidos y horas extra |
| Exportaciones de horario | PDF semanal, posiciones, extras y GeoVictoria | `/admin`, `/superadmin` | Implementado | Personal vigente por semana, turnos configurados y marcas visibles para horarios no mapeados |
| Ventas y proyección | `/admin/ventas`, análisis, proyección | `/admin`, `/superadmin` | VHL/THL operativo implementado; configuración, análisis y proyección pendientes | Historia, posiciones y proyecciones |
| RR. HH. / ceses | panel admin | `/admin` | Implementado | Fecha y motivos sincronizados en una transacción |
| Reporte completo | exportación actual | `/admin` | Implementado (CSV para Excel) | Incluye `cessation_reason` y `real_reason` |
| Feriados / horas extra | rutas staff/admin | `/staff`, `/admin`, `/superadmin` | Consultas, nocturnidad, detalle y autogestión staff implementados | Feriados ganados/compensados, extras manuales/importadas y periodos GeoVictoria |
| Entrenamiento | `/entrenamiento` | `/training` | Acceso implementado | Roles trainer/admin/superadmin |

## Política de caché

- Datos consultados: 5 minutos frescos, máximo 30 minutos en `sessionStorage`.
- Clave y versión separadas por `userId`; se elimina al cerrar sesión.
- Autenticación, rol, estado y fecha de cese nunca se toman del caché de consultas.
- Mutaciones futuras deberán invalidar las claves afectadas inmediatamente.
