import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/admin/presentation/screens/admin_dashboard_screen.dart';
import '../../features/collaborator/presentation/screens/collaborator_dashboard_screen.dart';
import '../../features/collaborator/presentation/screens/skills_screen.dart';
import '../../features/collaborator/presentation/screens/schedule_swap_screen.dart';
import '../../features/collaborator/presentation/screens/study_schedule_screen.dart';
import '../../features/admin/presentation/screens/staff_overview_screen.dart';
import '../../features/admin/presentation/screens/positioning_screen.dart';
import '../../features/admin/presentation/screens/swap_requests_screen.dart';
import '../../features/admin/presentation/screens/skills_monitor_screen.dart';
import '../../features/admin/presentation/screens/requirements_screen.dart';
import '../../features/admin/presentation/screens/skills_management_screen.dart';
import '../../features/admin/presentation/screens/requirements_editor_screen.dart';
import '../../features/notifications/presentation/screens/notifications_screen.dart';
import '../../features/auth/data/providers/auth_provider.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authStateProvider);
  
  return GoRouter(
    initialLocation: '/splash',
    redirect: (context, state) {
      final isLoggedIn = authState.maybeWhen(
        data: (user) => user != null,
        orElse: () => false,
      );
      final isLoading = authState.isLoading;
      final hasError = authState.hasError;
      final isSplash = state.matchedLocation == '/splash';
      final isLogin = state.matchedLocation == '/login';
      
      // Si está cargando, mostrar splash
      if (isLoading && !isSplash) return '/splash';
      
      // Si terminó de cargar (ya no está loading)
      if (!isLoading) {
        // Si no está logueado y no está en login, ir a login
        if (!isLoggedIn && !isLogin) return '/login';
        
        // Si está logueado y está en login o splash, ir a home
        if (isLoggedIn && (isLogin || isSplash)) {
          return '/home';
        }
      }
      
      // Si hay error, ir a login
      if (hasError && !isLogin) return '/login';
      
      return null;
    },
    routes: [
      // Splash Screen
      GoRoute(
        path: '/splash',
        builder: (context, state) => const SplashScreen(),
      ),
      
      // Auth Routes
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      
      // Home - Redirecciona según rol
      GoRoute(
        path: '/home',
        builder: (context, state) => const RoleBasedHomeScreen(),
      ),
      
      // Admin Routes
      GoRoute(
        path: '/admin',
        builder: (context, state) => const AdminDashboardScreen(),
        routes: [
          GoRoute(
            path: 'staff',
            builder: (context, state) => const StaffOverviewScreen(),
          ),
          GoRoute(
            path: 'positioning/:day',
            builder: (context, state) => PositioningScreen(
              day: state.pathParameters['day']!,
            ),
          ),
          GoRoute(
            path: 'swap-requests',
            builder: (context, state) => const SwapRequestsScreen(),
          ),
          GoRoute(
            path: 'skills-monitor',
            builder: (context, state) => const SkillsMonitorScreen(),
          ),
          GoRoute(
            path: 'requirements',
            builder: (context, state) => const RequirementsScreen(),
          ),
          GoRoute(
            path: 'skills-management',
            builder: (context, state) => const SkillsManagementScreen(),
          ),
          GoRoute(
            path: 'requirements-editor',
            builder: (context, state) => const RequirementsEditorScreen(),
          ),
        ],
      ),
      
      // Collaborator Routes
      GoRoute(
        path: '/staff',
        builder: (context, state) => const CollaboratorDashboardScreen(),
        routes: [
          GoRoute(
            path: 'skills',
            builder: (context, state) => const SkillsScreen(),
          ),
          GoRoute(
            path: 'swap',
            builder: (context, state) => const ScheduleSwapScreen(),
          ),
          GoRoute(
            path: 'study',
            builder: (context, state) => const StudyScheduleScreen(),
          ),
        ],
      ),
      
      // Notifications
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline,
              size: 64,
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              'Página no encontrada',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Text(
              state.matchedLocation,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () => context.go('/home'),
              child: const Text('Ir al inicio'),
            ),
          ],
        ),
      ),
    ),
  );
});

/// Screen que determina qué dashboard mostrar según el rol del usuario
class RoleBasedHomeScreen extends ConsumerWidget {
  const RoleBasedHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userDataAsync = ref.watch(userDataProvider);
    
    return userDataAsync.when(
      data: (userData) {
        if (userData == null) {
          // Si no hay datos de usuario, ir a login
          WidgetsBinding.instance.addPostFrameCallback((_) {
            context.go('/login');
          });
          return const SplashScreen();
        }
        
        final role = userData['role'] as String?;
        
        switch (role) {
          case 'superadmin':
          case 'admin':
            return const AdminDashboardScreen();
          case 'collaborator':
            return const CollaboratorDashboardScreen();
          default:
            return const CollaboratorDashboardScreen();
        }
      },
      loading: () => const SplashScreen(),
      error: (error, stack) => Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.error_outline, size: 48, color: Colors.red),
              const SizedBox(height: 16),
              Text('Error: $error'),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () => context.go('/login'),
                child: const Text('Reintentar'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
