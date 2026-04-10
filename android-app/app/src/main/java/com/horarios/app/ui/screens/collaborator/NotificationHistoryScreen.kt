package com.horarios.app.ui.screens.collaborator

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationHistoryScreen(
    onBack: () -> Unit
) {
    val notifications = listOf(
        AppNotification("Recordatorio de Horarios", "Por favor, ingresa tu disponibilidad académica antes del viernes.", "Hace 2 horas", true),
        AppNotification("Nuevo Horario Publicado", "Ya puedes revisar tus turnos para la próxima semana.", "Ayer", false),
        AppNotification("Actualización de Tienda", "Reunión de equipo este jueves a las 11:00 AM.", "Hace 3 días", false)
    )

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Centro de Avisos") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(notifications) { notification ->
                NotificationItem(notification)
            }
        }
    }
}

data class AppNotification(
    val title: String,
    val message: String,
    val time: String,
    val isNew: Boolean
)

@Composable
fun NotificationItem(notification: AppNotification) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (notification.isNew) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.2f) else MaterialTheme.colorScheme.surface
        )
    ) {
        Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier.size(40.dp).background(MaterialTheme.colorScheme.primary.copy(alpha = 0.1f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Default.Notifications, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            }
            
            Spacer(modifier = Modifier.width(16.dp))
            
            Column(modifier = Modifier.weight(1f)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(notification.title, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    if (notification.isNew) {
                        Surface(color = Color.Red, shape = CircleShape) {
                            Box(modifier = Modifier.size(8.dp))
                        }
                    }
                }
                Text(notification.message, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                Spacer(modifier = Modifier.height(4.dp))
                Text(notification.time, fontSize = 10.sp, color = Color.LightGray)
            }
        }
    }
}
