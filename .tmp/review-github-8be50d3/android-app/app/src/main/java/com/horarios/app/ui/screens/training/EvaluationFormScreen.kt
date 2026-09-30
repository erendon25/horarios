package com.horarios.app.ui.screens.training

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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EvaluationFormScreen(
    staffName: String,
    area: String,
    onBack: () -> Unit
) {
    val criteria = when(area) {
        "Servicio" -> listOf("Atención al Cliente", "Imagen Personal", "Protocolos de Venta", "Manejo de Reclamos")
        else -> listOf("Calidad de Producto", "Rapidez en Preparación", "Limpieza de Área", "Seguridad Alimentaria")
    }
    
    val scores = remember { mutableStateMapOf<String, Float>() }
    
    LaunchedEffect(Unit) {
        criteria.forEach { scores[it] = 3.0f } // Default score
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Column {
                    Text("Evaluando a $staffName", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Text("Área: $area", fontSize = 12.sp, color = Color.Gray)
                } },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    TextButton(onClick = { /* Save evaluation */ }) {
                        Text("GUARDAR", fontWeight = FontWeight.ExtraBold)
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {
            item {
                Text(
                    "Califica del 1 al 5 cada uno de los siguientes puntos estratégicos.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Color.Gray
                )
            }

            items(criteria) { criterion ->
                CriterionInput(
                    label = criterion,
                    value = scores[criterion] ?: 3.0f,
                    onValueChange = { scores[criterion] = it }
                )
            }

            item {
                var notes by remember { mutableStateOf("") }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Observaciones / Feedback") },
                    modifier = Modifier.fillMaxWidth().height(120.dp),
                    shape = RoundedCornerShape(12.dp)
                )
                
                Spacer(modifier = Modifier.height(24.dp))
                
                Button(
                    onClick = { /* Save */ },
                    modifier = Modifier.fillMaxWidth().height(56.dp),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Save, null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Finalizar Evaluación")
                }
                Spacer(modifier = Modifier.height(40.dp))
            }
        }
    }
}

@Composable
fun CriterionInput(label: String, value: Float, onValueChange: (Float) -> Unit) {
    Column {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, fontWeight = FontWeight.SemiBold)
            Text(value.toInt().toString(), fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.primary)
        }
        Slider(
            value = value,
            onValueChange = onValueChange,
            valueRange = 1f..5f,
            steps = 3,
            modifier = Modifier.padding(top = 4.dp)
        )
    }
}
