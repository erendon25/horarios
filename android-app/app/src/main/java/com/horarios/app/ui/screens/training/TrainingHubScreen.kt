package com.horarios.app.ui.screens.training

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrainingHubScreen(
    onLogout: () -> Unit,
    onNavigateToEvaluation: (String, String) -> Unit, // staffId, area
    onNavigateToStats: () -> Unit
) {
    var activeArea by remember { mutableStateOf("Servicio") }
    var searchQuery by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Módulo de Entrenamiento") },
                actions = {
                    IconButton(onClick = onNavigateToStats) {
                        Icon(Icons.Default.BarChart, contentDescription = "Estadísticas")
                    }
                    IconButton(onClick = onLogout) {
                        Icon(Icons.Default.ExitToApp, contentDescription = "Salir")
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            // Area Selector
            Row(
                modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(12.dp)).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                AreaTab("Servicio", activeArea == "Servicio", Modifier.weight(1f)) { activeArea = "Servicio" }
                AreaTab("Producción", activeArea == "Producción", Modifier.weight(1f)) { activeArea = "Producción" }
            }

            Spacer(modifier = Modifier.height(24.dp))

            Text("Evaluar Colaborador", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Buscar nombre...") },
                leadingIcon = { Icon(Icons.Default.Search, null) },
                shape = RoundedCornerShape(12.dp),
                singleLine = true
            )

            Spacer(modifier = Modifier.height(16.dp))

            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(listOf("Ana Torres", "Luis Meza", "Kevin Soto", "Maria Luz")) { name ->
                    CollaboratorEvaluationCard(
                        name = name,
                        area = activeArea,
                        onEvaluate = { onNavigateToEvaluation("id_mock", activeArea) }
                    )
                }
            }
        }
    }
}

@Composable
fun AreaTab(title: String, isSelected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = modifier.height(40.dp),
        shape = RoundedCornerShape(8.dp),
        color = if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent,
        contentColor = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    ) {
        Box(contentAlignment = Alignment.Center) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}

@Composable
fun CollaboratorEvaluationCard(name: String, area: String, onEvaluate: () -> Unit) {
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
                Box(modifier = Modifier.size(40.dp).background(Color.Gray.copy(alpha = 0.1f), CircleShape), contentAlignment = Alignment.Center) {
                    Text(name.first().toString(), fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.width(12.dp))
                Column {
                    Text(name, fontWeight = FontWeight.Bold)
                    Text("Nivel: Aprendiz", style = MaterialTheme.typography.bodySmall, color = Color.Gray)
                }
            }
            Button(
                onClick = onEvaluate,
                modifier = Modifier.height(36.dp),
                shape = RoundedCornerShape(8.dp),
                contentPadding = PaddingValues(horizontal = 12.dp)
            ) {
                Text("Evaluar", fontSize = 12.sp)
            }
        }
    }
}
