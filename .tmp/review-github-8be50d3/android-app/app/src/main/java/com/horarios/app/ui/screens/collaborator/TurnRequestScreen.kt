package com.horarios.app.ui.screens.collaborator

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TurnRequestScreen(
    onBack: () -> Unit
) {
    var selectedDay by remember { mutableStateOf("Lunes") }
    var shiftPreference by remember { mutableStateOf("Mañana (08:00 - 16:45)") }
    var comments by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Solicitar Cambio de Turno") },
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
            Text(
                "Utiliza este formulario para solicitar una excepción o preferencia en tu horario habitual.",
                style = MaterialTheme.typography.bodyMedium
            )

            Text("Día de la Solicitud", fontWeight = FontWeight.Bold)
            DaySelector(selectedDay) { selectedDay = it }

            Text("Preferencia de Turno", fontWeight = FontWeight.Bold)
            ShiftSelector(shiftPreference) { shiftPreference = it }

            OutlinedTextField(
                value = comments,
                onValueChange = { comments = it },
                label = { Text("Razón del cambio") },
                modifier = Modifier.fillMaxWidth().height(120.dp),
                placeholder = { Text("Ej: Cita médica, trámite personal...") }
            )

            Spacer(modifier = Modifier.weight(1f))

            Button(
                onClick = { /* Submit */ },
                modifier = Modifier.fillMaxWidth().height(56.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Icon(Icons.Default.SwapHoriz, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Enviar Preferencia")
            }
        }
    }
}

@Composable
fun DaySelector(selected: String, onSelect: (String) -> Unit) {
    val days = listOf("Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom")
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        days.forEach { day ->
            FilterChip(
                selected = selected.startsWith(day),
                onClick = { onSelect(day) },
                label = { Text(day) },
                modifier = Modifier.weight(1f)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShiftSelector(selected: String, onSelect: (String) -> Unit) {
    val shifts = listOf("Mañana (08:00 - 16:45)", "Tarde (13:15 - 22:00)", "Cierre (16:00 - 00:00)")
    var expanded by remember { mutableStateOf(false) }

    ExposedDropdownMenuBox(
        expanded = expanded,
        onExpandedChange = { expanded = !expanded }
    ) {
        OutlinedTextField(
            value = selected,
            onValueChange = {},
            readOnly = true,
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor()
        )
        ExposedDropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false }
        ) {
            shifts.forEach { shift ->
                DropdownMenuItem(
                    text = { Text(shift) },
                    onClick = {
                        onSelect(shift)
                        expanded = false
                    }
                )
            }
        }
    }
}
