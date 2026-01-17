# Guía de Configuración y Solución de Problemas - LC Scheduler App

## 1. Estado del Proyecto
Se han implementado todas las funcionalidades solicitadas (Requerimientos, Monitor de Skills, Horarios de Estudio, Skills de Colaborador), optimizando el consumo de Firebase mediante **carga manual** (sin streams en tiempo real) y botones de "Guardar/Actualizar".

## 2. Solución a Error de Compilación Web
Si encuentras el error `User is from package:firebase_auth_web` al compilar, esto se debe a incompatibilidad entre versiones recientes de Flutter y los plugins web de Firebase.

**Pasos para solucionar:**
1. Limpia el proyecto:
   ```bash
   flutter clean
   flutter pub get
   ```
2. Intenta compilar forzando el renderizador HTML (más estable para interop):
   ```bash
   flutter build web --web-renderer html
   ```

## 3. Configuración para Móviles (Android/iOS)
Para ejecutar la app en un dispositivo o emulador, necesitas vincular el proyecto con Firebase:

1. Instala **Firebase CLI** si no lo tienes.
2. Ejecuta en la terminal de la carpeta `lc_scheduler_app`:
   ```bash
   flutterfire configure
   ```
3. Sigue los pasos seleccionando el proyecto `lc-scheduler`.
4. Esto generará automáticamente `android/app/google-services.json` (Android) y `ios/Runner/GoogleService-Info.plist` (iOS).

## 4. Funcionalidades Offline/Manuales
Para evitar costos excesivos, las siguientes pantallas ahora funcionan bajo demanda:
- **Requerimientos (Admin)**: Botón "Actualizar" en la barra superior.
- **Monitor de Skills (Admin)**: Botón "Actualizar" y filtros locales.
- **Mis Skills (Colaborador)**: Botón "Guardar" para confirmar cambios.
- **Horarios de Estudio (Colaborador)**: Botón "Guardar" para confirmar cambios.
