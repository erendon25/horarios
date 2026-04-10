package com.horarios.app.ui.screens.superadmin

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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SuperAdminDashboard(onLogout: () -> Unit) {
    var selectedTab by remember { mutableStateOf(0) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Storefront, null) },
                    label = { Text("Tiendas") },
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.People, null) },
                    label = { Text("Usuarios") },
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 }
                )
                NavigationBarItem(
                    icon = { Icon(Icons.Default.Settings, null) },
                    label = { Text("Sistema") },
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 }
                )
            }
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            when (selectedTab) {
                0 -> StoreManagementTab()
                1 -> UserManagementTab()
                2 -> SystemSettingsTab(onLogout)
            }
        }
    }
}

@Composable
fun StoreManagementTab() {
    Column {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Gestión de Tiendas", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            IconButton(onClick = {}) { Icon(Icons.Default.Add, null) }
        }
        Spacer(modifier = Modifier.height(16.dp))
        
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(listOf("Tienda Aramburú", "Tienda Benavides", "Tienda Larco", "Tienda Salaverry")) { store ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Row(modifier = Modifier.padding(16.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column {
                            Text(store, fontWeight = FontWeight.Bold)
                            Text("Activa", color = Color(0xFF4CAF50), style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Default.ChevronRight, null)
                    }
                }
            }
        }
    }
}

@Composable
fun UserManagementTab() {
    Text("Gestión de Usuarios Globales", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
    // List of admins/superadmins
}

@Composable
fun SystemSettingsTab(onLogout: () -> Unit) {
    Column {
        Text("Ajustes del Sistema", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(24.dp))
        
        ListItem(
            headlineContent = { Text("Logs del Sistema") },
            leadingContent = { Icon(Icons.Default.Storage, null) }
        )
        ListItem(
            headlineContent = { Text("Cerrar Sesión") },
            leadingContent = { Icon(Icons.Default.ExitToApp, null, tint = MaterialTheme.colorScheme.error) },
            modifier = Modifier.background(Color.Transparent).padding(0.dp),
            trailingContent = { IconButton(onClick = onLogout) { Icon(Icons.Default.ChevronRight, null) } }
        )
    }
}
