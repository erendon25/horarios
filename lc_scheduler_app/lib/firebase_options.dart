import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

/// Configuración de Firebase para LC Scheduler
/// Usa las mismas credenciales que la web app existente
class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      return web;
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      case TargetPlatform.macOS:
        return macos;
      case TargetPlatform.windows:
        return web;
      case TargetPlatform.linux:
        return web;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions no configurado para esta plataforma.',
        );
    }
  }

  // Credenciales del proyecto Firebase existente
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs',
    appId: '1:1054512970764:web:04a1998876863b4063c229',
    messagingSenderId: '1054512970764',
    projectId: 'lc-scheduler',
    authDomain: 'lc-scheduler.firebaseapp.com',
    storageBucket: 'lc-scheduler.appspot.com',
    measurementId: 'G-VKGFTSCSMS',
  );

  // Para Android - deberás registrar la app en Firebase Console
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs',
    appId: '1:1054512970764:android:YOUR_ANDROID_APP_ID', // Actualizar después de registrar
    messagingSenderId: '1054512970764',
    projectId: 'lc-scheduler',
    storageBucket: 'lc-scheduler.appspot.com',
  );

  // Para iOS - deberás registrar la app en Firebase Console
  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs',
    appId: '1:1054512970764:ios:YOUR_IOS_APP_ID', // Actualizar después de registrar
    messagingSenderId: '1054512970764',
    projectId: 'lc-scheduler',
    storageBucket: 'lc-scheduler.appspot.com',
    iosBundleId: 'com.lcscheduler.app',
  );

  static const FirebaseOptions macos = FirebaseOptions(
    apiKey: 'AIzaSyDumwsFqGDE4esA-kB_51yrhTl38DeqDTs',
    appId: '1:1054512970764:ios:YOUR_IOS_APP_ID',
    messagingSenderId: '1054512970764',
    projectId: 'lc-scheduler',
    storageBucket: 'lc-scheduler.appspot.com',
    iosBundleId: 'com.lcscheduler.app',
  );
}
