package com.horarios.app.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import com.horarios.app.notifications.NotificationHelper
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboard(
    onLogout: () -> Unit,
    onNavigateToCoverage: () -> Unit,
    onNavigateToStaffDetail: (String) -> Unit,
    onNavigateToCessation: (String) -> Unit,
    onNavigateToMatrix: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(0) }
    
    val tabs = listOf(
        AdminTabItem("Plantilla", Icons.Default.Group),
        AdminTabItem("Cobertura", Icons.Default.ViewQuilt),
        AdminTabItem("Métricas", Icons.Default.BarChart),
        AdminTabItem("Ajustes", Icons.Default.Settings)
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
                0 -> AdminTeamTab(onNavigateToStaffDetail, onNavigateToCessation)
                1 -> AdminCoverageTab(onNavigateToCoverage, onNavigateToMatrix)
                2 -> AdminMetricsTab()
                3 -> AdminSettingsTab(onLogout)
            }
        }
    }
}

data class AdminTabItem(val title: String, val icon: ImageVector)

@Composable
fun AdminTeamTab(
    onNavigateToStaffDetail: (String) -> Unit,
    onNavigateToCessation: (String) -> Unit
) {
    var searchQuery by remember { mutableStateOf("") }
    
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Gestión de Equipo", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(16.dp))
        
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Buscar colaborador...") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            shape = RoundedCornerShape(12.dp),
            singleLine = true
        )
        
        Spacer(modifier = Modifier.height(16.dp))
        
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(listOf("Carlos Ruiz", "Elena Gómez", "Roberto Díaz", "Ana Loayza")) { name ->
                StaffMemberCard(
                    name = name, 
                    onDetail = { onNavigateToStaffDetail("id_mock") },
                    onCessation = { onNavigateToCessation(name) }
                )
            }
        }
    }
}

@Composable
fun StaffMemberCard(name: String, onDetail: () -> Unit, onCessation: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    modifier = Modifier.size(40.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), RoundedCornerShape(20.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text(name.first().toString(), fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(name, fontWeight = FontWeight.Bold)
                    Text("COLABORADOR", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
            }
            Row {
                IconButton(onClick = onDetail) {
                    Icon(Icons.Default.Edit, contentDescription = "Editar", tint = MaterialTheme.colorScheme.primary)
                }
                IconButton(onClick = onCessation) {
                    Icon(Icons.Default.PersonRemove, contentDescription = "Baja", tint = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}

@Composable
fun AdminCoverageTab(onNavigateToCoverage: () -> Unit, onNavigateToMatrix: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Cobertura de Hoy", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(16.dp))
        
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            onClick = onNavigateToCoverage
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Text("Resumen Diario", fontWeight = FontWeight.Bold)
                Spacer(modifier = Modifier.height(8.dp))
                Text("Caja: 100% | Producción: 85%", color = Color.Gray)
                Text("Brecha: 2 personas pendientes", color = MaterialTheme.colorScheme.error)
            }
        }
        
        Spacer(modifier = Modifier.height(16.dp))
        
        Button(
            onClick = onNavigateToMatrix,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(12.dp)
        ) {
            Icon(Icons.Default.ViewQuilt, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Editar Matriz de Personal")
        }
    }
}

@Composable
fun AdminMetricsTab() {
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Métricas de Tienda", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(16.dp))
        
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricCard("Plantilla", "24", Modifier.weight(1f))
            MetricCard("Full-Time", "60%", Modifier.weight(1f))
        }
    }
}

@Composable
fun MetricCard(title: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier, shape = RoundedCornerShape(12.dp)) {
        Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(title, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
fun AdminSettingsTab(onLogout: () -> Unit) {
    val context = LocalContext.current
    
    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Configuración", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(24.dp))
        
        Button(
            onClick = { 
                NotificationHelper.showReminder(
                    context, 
                    "Aviso de Tienda", 
                    "Por favor, ingresen sus disponibilidades para la próxima semana."
                )
            },
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondaryContainer, contentColor = MaterialTheme.colorScheme.onSecondaryContainer)
        ) {
            Icon(Icons.Default.NotificationsActive, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Enviar Recordatorios (Push)")
        }
        
        Spacer(modifier = Modifier.weight(1f))
        
        OutlinedButton(
            onClick = onLogout,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
        ) {
            Icon(Icons.Default.ExitToApp, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Cerrar Sesión")
        }
    }
}
