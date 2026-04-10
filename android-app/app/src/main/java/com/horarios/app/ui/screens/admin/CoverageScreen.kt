package com.horarios.app.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CalendarToday
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
fun CoverageScreen(
    onBack: () -> Unit
) {
    var selectedDay by remember { mutableStateOf("Hoy (Lunes)") }
    
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Cobertura de Personal") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(12.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)
            ) {
                Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CalendarToday, contentDescription = null)
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(selectedDay, fontWeight = FontWeight.Bold)
                }
            }
            
            Spacer(modifier = Modifier.height(16.dp))
            
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item { Text("Estado por Posición", fontWeight = FontWeight.SemiBold, color = Color.Gray) }
                
                items(listOf("Producción", "Atención", "Limpieza", "Caja")) { pos ->
                    CoverageItem(position = pos, assigned = (8..12).random(), required = 10)
                }
            }
        }
    }
}

@Composable
fun CoverageItem(position: String, assigned: Int, required: Int) {
    val statusColor = if (assigned >= required) Color(0xFF4CAF50) else Color(0xFFF44336)
    
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(position, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text("$assigned / $required Colabs", color = statusColor, fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = assigned.toFloat() / required.toFloat(),
                modifier = Modifier.fillMaxWidth().height(6.dp),
                color = statusColor,
                trackColor = statusColor.copy(alpha = 0.2f)
            )
        }
    }
}
