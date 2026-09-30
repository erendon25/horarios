package com.horarios.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.horarios.app.notifications.NotificationHelper
import com.horarios.app.ui.screens.LoginScreen
import com.horarios.app.ui.screens.RegisterScreen
import com.horarios.app.ui.screens.ForgotPasswordScreen
import com.horarios.app.ui.screens.admin.AdminDashboard
import com.horarios.app.ui.screens.admin.CoverageScreen
import com.horarios.app.ui.screens.admin.StaffDetailsScreen
import com.horarios.app.ui.screens.admin.StaffCessationScreen
import com.horarios.app.ui.screens.admin.StorePositioningEditor
import com.horarios.app.ui.screens.collaborator.CollaboratorDashboard
import com.horarios.app.ui.screens.collaborator.HolidayRequestScreen
import com.horarios.app.ui.screens.collaborator.TurnRequestScreen
import com.horarios.app.ui.screens.collaborator.StudyScheduleForm
import com.horarios.app.ui.screens.collaborator.NotificationHistoryScreen
import com.horarios.app.ui.screens.training.TrainingHubScreen
import com.horarios.app.ui.screens.training.EvaluationFormScreen
import com.horarios.app.ui.screens.training.TrainingStatsScreen
import com.horarios.app.ui.screens.superadmin.SuperAdminDashboard
import com.horarios.app.ui.theme.HorariosTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Inicializar canales de notificación
        NotificationHelper.createNotificationChannel(this)
        
        setContent {
            HorariosTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AppNavigation()
                }
            }
        }
    }
}

@Composable
fun AppNavigation() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = "login") {
        composable("login") { 
            LoginScreen(
                onNavigateToRegister = { navController.navigate("register") },
                onNavigateToForgot = { navController.navigate("forgot_password") },
                onLoginSuccess = { role ->
                    when (role) {
                        "superadmin" -> navController.navigate("superadmin_dashboard") { popUpTo("login") { inclusive = true } }
                        "admin" -> navController.navigate("admin_dashboard") { popUpTo("login") { inclusive = true } }
                        "trainer" -> navController.navigate("training_hub") { popUpTo("login") { inclusive = true } }
                        "collaborator" -> navController.navigate("collaborator_dashboard") { popUpTo("login") { inclusive = true } }
                    }
                }
            ) 
        }
        composable("register") { 
            RegisterScreen(onBack = { navController.popBackStack() }) 
        }
        composable("forgot_password") { 
            ForgotPasswordScreen(onBack = { navController.popBackStack() }) 
        }
        composable("collaborator_dashboard") {
            CollaboratorDashboard(
                onLogout = { navController.navigate("login") { popUpTo(0) } },
                onNavigateToStudySchedule = { navController.navigate("study_schedule") },
                onNavigateToHolidayRequest = { navController.navigate("holiday_request") },
                onNavigateToTurnRequest = { navController.navigate("turn_request") },
                onNavigateToNotifications = { navController.navigate("notifications_history") }
            )
        }
        composable("notifications_history") {
            NotificationHistoryScreen(onBack = { navController.popBackStack() })
        }
        composable("study_schedule") {
            StudyScheduleForm(onBack = { navController.popBackStack() })
        }
        composable("holiday_request") {
            HolidayRequestScreen(onBack = { navController.popBackStack() })
        }
        composable("turn_request") {
            TurnRequestScreen(onBack = { navController.popBackStack() })
        }
        composable("admin_dashboard") {
            AdminDashboard(
                onLogout = { navController.navigate("login") { popUpTo(0) } },
                onNavigateToCoverage = { navController.navigate("admin_coverage") },
                onNavigateToStaffDetail = { id -> navController.navigate("admin_staff_detail/$id") },
                onNavigateToCessation = { name -> navController.navigate("admin_cessation/$name") },
                onNavigateToMatrix = { navController.navigate("admin_matrix") }
            )
        }
        composable("admin_coverage") {
            CoverageScreen(onBack = { navController.popBackStack() })
        }
        composable("admin_staff_detail/{staffId}") { backStackEntry ->
            val staffId = backStackEntry.arguments?.getString("staffId") ?: ""
            StaffDetailsScreen(staffId = staffId, onBack = { navController.popBackStack() })
        }
        composable("admin_cessation/{staffName}") { backStackEntry ->
            val staffName = backStackEntry.arguments?.getString("staffName") ?: ""
            StaffCessationScreen(staffName = staffName, onBack = { navController.popBackStack() })
        }
        composable("admin_matrix") {
            StorePositioningEditor(onBack = { navController.popBackStack() })
        }
        composable("training_hub") {
            TrainingHubScreen(
                onLogout = { navController.navigate("login") { popUpTo(0) } },
                onNavigateToEvaluation = { id, area -> navController.navigate("evaluation_form/$id/$area") },
                onNavigateToStats = { navController.navigate("training_stats") }
            )
        }
        composable("evaluation_form/{staffId}/{area}") { backStackEntry ->
            val staffId = backStackEntry.arguments?.getString("staffId") ?: ""
            val area = backStackEntry.arguments?.getString("area") ?: ""
            EvaluationFormScreen(staffName = "Colaborador Seleccionado", area = area, onBack = { navController.popBackStack() })
        }
        composable("training_stats") {
            TrainingStatsScreen(onBack = { navController.popBackStack() })
        }
        composable("superadmin_dashboard") {
            SuperAdminDashboard(onLogout = { navController.navigate("login") { popUpTo(0) } })
        }
    }
}
