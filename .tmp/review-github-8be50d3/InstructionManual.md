# Manual de Implementación - App de Horarios

Este proyecto contiene dos versiones optimizadas para diferentes plataformas, compartiendo la misma estética profesional y minimalista.

## 1. Aplicación Nativa Android (Kotlin)
Ubicación: `android-app/`

Esta versión está construida con **Jetpack Compose**, el framework moderno de Google para apps nativas.

### Características:
- **UI Profesional**: Tema oscuro y claro basado en una paleta de grises y carbón.
- **Flujo Completo**: Pantallas de Login, Registro y Recuperación de Contraseña.
- **Notificaciones**: Sistema nativo para recordatorios de disponibilidad y horarios.
- **Recursos**: Icono y Splash Screen generados específicamente para el proyecto.

### Cómo ejecutar:
1. Abre **Android Studio**.
2. Selecciona "Open" y busca la carpeta `android-app`.
3. Deja que Gradle sincronice el proyecto.
4. Conecta un dispositivo o emulador y presiona "Run".

---

## 2. Versión Web (React)
Ubicación: `web-version/`

Una interfaz web de alta gama diseñada con React y Vite.

### Características:
- **Diseño Premium**: Efectos de Glassmorphism (vidrio esmerilado) y animaciones fluidas con Framer Motion.
- **Adaptabilidad**: 
  - **Desktop**: Barra lateral elegante.
  - **Mobile**: Navbar inferior intuitivo (Bottom Bar).
- **Dashboard**: Resumen de turnos, carga horaria y alertas de disponibilidad.

### Cómo ejecutar:
1. Abre una terminal en `web-version/`.
2. Ejecuta `npm run dev`.
3. Abre `http://localhost:5173` en tu navegador.

---

## Activos Generados
Los siguientes activos fueron creados para dar un toque profesional a la identidad de la app:
- **Icono**: `android-app/app/src/main/res/drawable/ic_launcher.png`
- **Splash Screen**: `android-app/app/src/main/res/drawable/splash_background.png`

---

## Notificaciones
Ambas versiones están preparadas para integrar sistemas de notificaciones:
- **Android**: Usa `NotificationHelper.kt` para disparar alertas locales.
- **Web**: Preparada para integrar Service Workers o Firebase Cloud Messaging.
