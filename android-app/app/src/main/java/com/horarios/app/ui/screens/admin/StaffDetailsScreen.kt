package com.horarios.app.ui.screens.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Save
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StaffDetailsScreen(
    staffId: String,
    onBack: () -> Unit
) {
    // State for form fields
    var name by remember { mutableStateOf("Juan") }
    var lastName by remember { mutableStateOf("Pérez") }
    var modality by remember { mutableStateOf("Full-Time") }
    var dni by remember { mutableStateOf("12345678") }
    var position by remember { mutableStateOf("COLABORADOR") }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Detalles del Staff") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    IconButton(onClick = { /* Save */ }) {
                        Icon(Icons.Default.Save, contentDescription = "Guardar")
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
                Text("Información Personal", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            }
            
            item {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Nombre") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
            
            item {
                OutlinedTextField(
                    value = lastName,
                    onValueChange = { lastName = it },
                    label = { Text("Apellido") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
            
            item {
                OutlinedTextField(
                    value = dni,
                    onValueChange = { dni = it },
                    label = { Text("DNI") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
            
            item {
                Text("Configuración de Trabajo", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            }
            
            item {
                var expanded by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(
                    expanded = expanded,
                    onExpandedChange = { expanded = !expanded }
                ) {
                    OutlinedTextField(
                        value = modality,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("Modalidad") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                        modifier = Modifier.fillMaxWidth().menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = expanded,
                        onDismissRequest = { expanded = false }
                    ) {
                        DropdownMenuItem(
                            text = { Text("Full-Time") },
                            onClick = { modality = "Full-Time"; expanded = false }
                        )
                        DropdownMenuItem(
                            text = { Text("Part-Time") },
                            onClick = { modality = "Part-Time"; expanded = false }
                        )
                    }
                }
            }
            
            item {
                Text("Balance de Feriados", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Card(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Días Acumulados")
                        Text("3", fontWeight = FontWeight.Bold)
                    }
                }
            }
            
            item {
                Spacer(modifier = Modifier.height(32.dp))
                Button(
                    onClick = { /* Delete logic */ },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.errorContainer)
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Eliminar Colaborador", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }
}
