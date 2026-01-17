# LC Scheduler - Aplicación Móvil

Aplicación móvil Flutter para iOS y Android que complementa la web app existente de gestión de horarios.

## 🚀 Características

### Para Administradores
- **Dashboard de estadísticas**: Vista rápida de personal Full-time y Part-time
- **Posicionamiento por día**: Visualiza las asignaciones de cada día de la semana
- **Gestión de cambios**: Aprueba o rechaza solicitudes de intercambio de horario
- **Notificaciones push**: Recibe alertas de nuevas solicitudes

### Para Colaboradores
- **Mi horario de hoy**: Consulta rápida del turno y posición del día
- **Skills personales**: Gestiona tus áreas de expertise
- **Cambio de horario**: Solicita intercambios con compañeros compatibles
- **Horarios de estudio**: Registra tu disponibilidad académica

## 📱 Instalación

### Prerrequisitos
1. [Flutter SDK](https://flutter.dev/docs/get-started/install) (versión 3.2.0 o superior)
2. Android Studio o Xcode
3. Cuenta de Firebase (usa el proyecto existente: `lc-scheduler`)

### Pasos de instalación

1. **Instalar Flutter** (si no está instalado):
   ```powershell
   # Windows - Descarga desde https://flutter.dev/docs/get-started/install/windows
   # Agrega Flutter al PATH
   ```

2. **Navegar al proyecto**:
   ```bash
   cd lc_scheduler_app
   ```

3. **Instalar dependencias**:
   ```bash
   flutter pub get
   ```

4. **Configurar Firebase para Android/iOS**:
   
   #### Android:
   1. Ve a [Firebase Console](https://console.firebase.google.com)
   2. Selecciona el proyecto `lc-scheduler`
   3. Agrega una app Android con el package name: `com.lcscheduler.app`
   4. Descarga `google-services.json` y colócalo en `android/app/`
   5. Actualiza `firebase_options.dart` con el `appId` de Android

   #### iOS:
   1. Agrega una app iOS con bundle ID: `com.lcscheduler.app`
   2. Descarga `GoogleService-Info.plist` y colócalo en `ios/Runner/`
   3. Actualiza `firebase_options.dart` con el `appId` de iOS

5. **Ejecutar la aplicación**:
   ```bash
   # Verificar dispositivos conectados
   flutter devices
   
   # Ejecutar en Android
   flutter run -d android
   
   # Ejecutar en iOS (requiere Mac)
   flutter run -d ios
   ```

## 📁 Estructura del Proyecto

```
lc_scheduler_app/
├── lib/
│   ├── main.dart                    # Punto de entrada
│   ├── firebase_options.dart        # Configuración Firebase
│   ├── core/
│   │   ├── models/                  # Modelos de datos
│   │   ├── router/                  # Navegación (GoRouter)
│   │   └── theme/                   # Tema y estilos
│   └── features/
│       ├── auth/                    # Autenticación
│       ├── admin/                   # Funcionalidades de admin
│       ├── collaborator/            # Funcionalidades de colaborador
│       └── notifications/           # Sistema de notificaciones
├── android/                         # Configuración Android
├── ios/                             # Configuración iOS
└── pubspec.yaml                     # Dependencias
```

## 🔥 Colecciones de Firestore Nuevas

La app utiliza las colecciones existentes y agrega las siguientes:

### `swap_requests` (Solicitudes de cambio)
```javascript
{
  requesterId: string,       // UID del solicitante
  requesterName: string,
  targetId: string,          // UID del compañero
  targetName: string,
  date: string,              // ISO date
  dayOfWeek: string,
  requesterShift: string,
  targetShift: string,
  storeId: string,
  status: "pending" | "approved" | "rejected",
  createdAt: string,
  respondedAt?: string,
  rejectionReason?: string
}
```

### `study_schedules` (Horarios de estudio)
```javascript
{
  uid: string,
  dayOfWeek: string,
  startTime: string,         // HH:mm
  endTime: string,
  subject?: string,
  institution?: string,
  isActive: boolean
}
```

### `notifications` (Notificaciones)
```javascript
{
  userId: string,
  title: string,
  body: string,
  type: "swapRequest" | "swapApproved" | "swapRejected" | "scheduleUpdated" | "reminder" | "announcement",
  data?: object,
  createdAt: string,
  isRead: boolean
}
```

### Campo nuevo en `staff_profiles`
```javascript
{
  // ... campos existentes
  skills: string[]           // Array de skills del colaborador
}
```

## 🎨 Diseño

La app utiliza un diseño moderno con:
- **Gradientes** premium en headers y cards
- **Animaciones** suaves con flutter_animate
- **Tema claro/oscuro** automático
- **Iconos Lucide** consistentes
- **Colores personalizados** según el rol y estado

## 📲 Compilar para Producción

### Android (APK):
```bash
flutter build apk --release
# El APK estará en build/app/outputs/flutter-apk/app-release.apk
```

### Android (App Bundle para Play Store):
```bash
flutter build appbundle --release
```

### iOS (requiere Mac y cuenta de Apple Developer):
```bash
flutter build ios --release
```

## 🔐 Reglas de Seguridad de Firestore

Agrega estas reglas a tu Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Swap requests
    match /swap_requests/{requestId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update: if request.auth != null && 
        (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin' ||
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'superadmin');
    }
    
    // Study schedules
    match /study_schedules/{scheduleId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && 
        resource.data.uid == request.auth.uid;
    }
    
    // Notifications
    match /notifications/{notificationId} {
      allow read: if request.auth != null && 
        resource.data.userId == request.auth.uid;
      allow update: if request.auth != null && 
        resource.data.userId == request.auth.uid;
    }
    
    // Staff profiles - agregar campo skills
    match /staff_profiles/{profileId} {
      allow read: if request.auth != null;
      allow update: if request.auth != null && 
        resource.data.uid == request.auth.uid;
    }
  }
}
```

## 📞 Soporte

Para soporte técnico, contacta al equipo de desarrollo.

---

**Versión**: 1.0.0  
**Última actualización**: Enero 2026
