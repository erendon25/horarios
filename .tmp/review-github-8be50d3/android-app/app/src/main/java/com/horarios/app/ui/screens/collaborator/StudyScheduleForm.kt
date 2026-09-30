package com.horarios.app.ui.screens.collaborator

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StudyScheduleForm(
    onBack: () -> Unit
) {
    val days = listOf("Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo")
    val scheduleState = remember { mutableStateMapOf<String, DayState>() }
    
    // Initialize days
    LaunchedEffect(Unit) {
        days.forEach { scheduleState[it] = DayState() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Mi Horario de Estudios") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    IconButton(onClick = { /* Save logic */ }) {
                        Icon(Icons.Default.Save, contentDescription = "Guardar", tint = MaterialTheme.colorScheme.primary)
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
                Text(
                    "Carga tus horarios académicos para evitar conflictos con tus turnos de trabajo.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
                )
            }
            
            items(days) { day ->
                DayScheduleInput(
                    day = day,
                    state = scheduleState[day] ?: DayState(),
                    onStateChange = { scheduleState[day] = it }
                )
            }
            
            item {
                Button(
                    onClick = { /* Save */ },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text("Guardar Cambios")
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}

data class DayState(
    val isFree: Boolean = false,
    val startTime: String = "08:00",
    val endTime: String = "12:00"
)

@Composable
fun DayScheduleInput(
    day: String,
    state: DayState,
    onStateChange: (DayState) -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(day, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Libre", style = MaterialTheme.typography.bodySmall)
                    Switch(
                        checked = state.isFree,
                        onCheckedChange = { onStateChange(state.copy(isFree = it)) }
                    )
                }
            }
            
            if (!state.isFree) {
                Spacer(modifier = Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = state.startTime,
                        onValueChange = { onStateChange(state.copy(startTime = it)) },
                        label = { Text("Inicio") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                    OutlinedTextField(
                        value = state.endTime,
                        onValueChange = { onStateChange(state.copy(endTime = it)) },
                        label = { Text("Fin") },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                }
            }
        }
    }
}
