package com.horarios.app.ui.screens.collaborator

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollaboratorDashboard(
    onLogout: () -> Unit,
    onNavigateToStudySchedule: () -> Unit,
    onNavigateToHolidayRequest: () -> Unit,
    onNavigateToTurnRequest: () -> Unit,
    onNavigateToNotifications: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }
    
    val tabs = listOf(
        TabItem("Inicio", Icons.Default.Home),
        TabItem("Horario", Icons.Default.CalendarToday),
        TabItem("Trámites", Icons.Default.Assignment),
        TabItem("Perfil", Icons.Default.Person)
    )

    Scaffold(
        bottomBar = {
            NavigationBar(
                containerColor = MaterialTheme.colorScheme.surface,
                tonalElevation = 8.dp
            ) {
                tabs.forEachIndexed { index, tab ->
                    NavigationBarItem(
                        icon = { Icon(tab.icon, contentDescription = tab.title) },
                        label = { Text(tab.title) },
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.primary,
                            indicatorColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f)
                        )
                    )
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(MaterialTheme.colorScheme.background)
        ) {
            when (selectedTab) {
                0 -> CollaboratorHomeTab(onNavigateToNotifications)
                1 -> CollaboratorScheduleTab()
                2 -> CollaboratorRequestsTab(
                    onNavigateToStudySchedule,
                    onNavigateToHolidayRequest,
                    onNavigateToTurnRequest
                )
                3 -> CollaboratorProfileTab(onLogout)
            }
        }
    }
}

data class TabItem(val title: String, val icon: ImageVector)

@Composable
fun CollaboratorHomeTab(onNavigateToNotifications: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text("Hola, Juan", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text("Tienda Aramburú", color = Color.Gray, fontSize = 14.sp)
            }
            IconButton(onClick = onNavigateToNotifications) {
                BadgedBox(
                    badge = { Badge { Text("1") } }
                ) {
                    Icon(Icons.Default.Notifications, contentDescription = "Notificaciones")
                }
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
        Text("Tu turno de hoy:", color = Color.Gray, fontWeight = FontWeight.SemiBold)
        
        Card(
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
        ) {
            Column(modifier = Modifier.padding(24.dp)) {
                Text("MAÑANA", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                Text("08:00 - 16:45", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                Spacer(modifier = Modifier.height(8.dp))
                Text("Posición: Producción", style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
fun CollaboratorScheduleTab() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Horario Semanal", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(16.dp))
        // Placeholder for schedule list
        Text("Próximamente: Vista de calendario semanal", color = Color.Gray)
    }
}

@Composable
fun CollaboratorRequestsTab(
    onNavigateToStudySchedule: () -> Unit,
    onNavigateToHolidayRequest: () -> Unit,
    onNavigateToTurnRequest: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Trámites y Solicitudes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(24.dp))
        
        RequestButton("Horario de Estudios", "Registra tus horas de clase", Icons.Default.School, onNavigateToStudySchedule)
        Spacer(modifier = Modifier.height(12.dp))
        RequestButton("Solicitar Vacaciones", "Consulta tu balance de días", Icons.Default.BeachAccess, onNavigateToHolidayRequest)
        Spacer(modifier = Modifier.height(12.dp))
        RequestButton("Cambio de Turno", "Solicitud de excepciones", Icons.Default.SwapHoriz, onNavigateToTurnRequest)
    }
}

@Composable
fun RequestButton(title: String, subtitle: String, icon: ImageVector, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(modifier = Modifier.size(48.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
            }
            Spacer(modifier = Modifier.width(16.dp))
            Column {
                Text(title, fontWeight = FontWeight.Bold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
    }
}

@Composable
fun CollaboratorProfileTab(onLogout: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(modifier = Modifier.size(100.dp).background(Color.Gray.copy(alpha = 0.2f), RoundedCornerShape(50.dp)), contentAlignment = Alignment.Center) {
            Icon(Icons.Default.Person, contentDescription = null, modifier = Modifier.size(60.dp), tint = Color.Gray)
        }
        Spacer(modifier = Modifier.height(16.dp))
        Text("Juan Pérez", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("Colaborador Full-Time", color = Color.Gray)
        
        Spacer(modifier = Modifier.height(32.dp))
        
        OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth()) {
            Text("Cerrar Sesión")
        }
    }
}
