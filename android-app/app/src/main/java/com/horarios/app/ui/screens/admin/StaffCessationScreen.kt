package com.horarios.app.ui.screens.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Warning
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
fun StaffCessationScreen(
    staffName: String,
    onBack: () -> Unit
) {
    var performance by remember { mutableStateOf("BUENO") }
    var cessationReason by remember { mutableStateOf("RENUNCIA VOLUNTARIA") }
    var comments by remember { mutableStateOf("") }
    
    // metrics
    var totalTardiness by remember { mutableStateOf("0") }
    var extraHours by remember { mutableStateOf("0") }
    var feriadosBalance by remember { mutableStateOf("0") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Reporte de Baja") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.2f))
                ) {
                    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.width(12.dp))
                        Text("Registrando cese para: $staffName", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    }
                }
            }

            item { Text("Evaluación y Motivos", fontWeight = FontWeight.Bold) }
            
            item {
                OutlinedTextField(
                    value = performance,
                    onValueChange = { performance = it },
                    label = { Text("Desempeño General") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = cessationReason,
                    onValueChange = { cessationReason = it },
                    label = { Text("Motivo de Cese") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item { Text("Liquidación y Asistencia", fontWeight = FontWeight.Bold) }

            item {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = totalTardiness,
                        onValueChange = { totalTardiness = it },
                        label = { Text("Tardanzas (min)") },
                        modifier = Modifier.weight(1f)
                    )
                    OutlinedTextField(
                        value = extraHours,
                        onValueChange = { extraHours = it },
                        label = { Text("Horas Extras") },
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            item {
                OutlinedTextField(
                    value = feriadosBalance,
                    onValueChange = { feriadosBalance = it },
                    label = { Text("Feriados por compensar") },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = comments,
                    onValueChange = { comments = it },
                    label = { Text("Comentario Detallado") },
                    modifier = Modifier.fillMaxWidth().height(100.dp),
                    maxLines = 5
                )
            }

            item {
                Spacer(modifier = Modifier.height(24.dp))
                Button(
                    onClick = { /* Submit cessation */ },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Finalizar y Registrar Cese")
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}
