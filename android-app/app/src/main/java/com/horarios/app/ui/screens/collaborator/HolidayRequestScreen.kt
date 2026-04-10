package com.horarios.app.ui.screens.collaborator

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HolidayRequestScreen(
    onBack: () -> Unit
) {
    var startDate by remember { mutableStateOf("") }
    var endDate by remember { mutableStateOf("") }
    var reason by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Solicitar Vacaciones") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f))
            ) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.DateRange, contentDescription = null)
                    Spacer(modifier = Modifier.width(12.dp))
                    Text("Balance Actual: 3 días disponibles", fontWeight = FontWeight.Bold)
                }
            }

            Text("Selecciona el periodo que deseas solicitar:", style = MaterialTheme.typography.titleMedium)

            OutlinedTextField(
                value = startDate,
                onValueChange = { startDate = it },
                label = { Text("Fecha de Inicio (DD/MM/YYYY)") },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Ej: 15/05/2026") }
            )

            OutlinedTextField(
                value = endDate,
                onValueChange = { endDate = it },
                label = { Text("Fecha de Fin (DD/MM/YYYY)") },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Ej: 22/05/2026") }
            )

            OutlinedTextField(
                value = reason,
                onValueChange = { reason = it },
                label = { Text("Motivo / Comentarios (Opcional)") },
                modifier = Modifier.fillMaxWidth().height(120.dp),
                maxLines = 4
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = { /* Submit request */ },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Enviar Solicitud")
            }
            
            Text(
                "Nota: Tu solicitud será revisada por el administrador de la tienda.",
                style = MaterialTheme.typography.bodySmall,
                color = Color.Gray,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }
}
