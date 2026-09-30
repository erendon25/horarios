# Manual de Implementación - Horarios App (Android Nativo)

Este documento detalla la estructura y los pasos para completar la aplicación nativa de Android basada en la lógica de tu plataforma web.

## 🚀 Arquitectura del Proyecto
La aplicación está construida utilizando **Kotlin** y **Jetpack Compose**, siguiendo un diseño minimalista y profesional con soporte para temas oscuros y claros.

### Estructura de Carpetas
- `data/model/Models.kt`: Modelos de datos que coinciden con Firestore (`StaffProfile`, `WeeklySchedule`, `Store`).
- `ui/screens/`:
    - `LoginScreen.kt`: Pantalla de inicio con soporte de roles.
    - `collaborator/CollaboratorDashboard.kt`: Panel para empleados (Horario, Perfil, Trámites).
    - `admin/AdminDashboard.kt`: Panel para administradores (Gestión de equipo, Cobertura, Métricas).
    - `admin/CoverageScreen.kt`: Monitor de cobertura en tiempo real adaptado a móvil.
    - `admin/StaffDetailsScreen.kt`: Editor de perfiles de colaborador.
    - `superadmin/SuperAdminDashboard.kt`: Gestión global de tiendas y administradores.
- `notifications/NotificationHelper.kt`: Sistema de notificaciones nativas para recordatorios.

## 🛠 Próximos Pasos (Firebase Integration)
Para que la aplicación sea funcional con tus datos actuales:

1. **Configurar Firebase**:
   - Agrega el archivo `google-services.json` en `app/`.
   - Implementa `FirebaseFirestore` en los ViewModels para reemplazar los datos "Mock".
2. **Lógica de Autenticación**:
   - En `LoginScreen.kt`, integra `FirebaseAuth` y recupera el documento del usuario desde la colección `users` para obtener el `role`.
3. **Calendario y Heatmap**:
   - La `CoverageScreen.kt` utiliza datos de ejemplo. Debes mapear la matriz de requerimientos de Firestore a los componentes de Compose.

## 🎨 Diseño Estético
Se ha mantenido una paleta de colores **Carbón y Gris Azulado** para evitar saturación visual. 
- **Navbar Inferior**: Facilita la navegación con una sola mano.
- **Micro-animaciones**: Implementadas a través de transiciones de estado en Compose.

## 📱 Notificaciones
El `NotificationHelper` ya está configurado para crear canales de importancia. Puedes disparar recordatorios desde el panel de Admin para que los colaboradores carguen sus disponibilidades académicas.

---
*Desarrollado por Antigravity para erendon25/horarios*
