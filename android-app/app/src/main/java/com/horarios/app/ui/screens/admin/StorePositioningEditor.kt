package com.horarios.app.ui.screens.admin

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Remove
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
fun StorePositioningEditor(
    onBack: () -> Unit
) {
    val positions = listOf("Producción", "Atención", "Caja", "Limpieza")
    val hourBlocks = (8..23).toList()
    
    // We'll simulate a 2D map for requirements: Map<Position, Map<Hour, Int>>
    val requirements = remember { mutableStateMapOf<String, MutableMap<Int, Int>>() }
    
    LaunchedEffect(Unit) {
        positions.forEach { pos ->
            val hourMap = mutableStateMapOf<Int, Int>()
            hourBlocks.forEach { hour -> hourMap[hour] = 2 } // Default 2 people
            requirements[pos] = hourMap
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Matriz de Personal") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Volver")
                    }
                },
                actions = {
                    IconButton(onClick = { /* Save matrix */ }) {
                        Icon(Icons.Default.Save, contentDescription = "Guardar", tint = MaterialTheme.colorScheme.primary)
                    }
                }
            )
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            TabRow(
                selectedTabIndex = 0, // In a real app, this would switch between days of the week
                containerColor = MaterialTheme.colorScheme.surface
            ) {
                Tab(selected = true, onClick = {}, text = { Text("Lunes") })
                Tab(selected = false, onClick = {}, text = { Text("Martes") })
                Tab(selected = false, onClick = {}, text = { Text("Mié...") })
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize().padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                items(positions) { position ->
                    PositionRequirementCard(
                        name = position,
                        hours = hourBlocks,
                        hourValues = requirements[position] ?: mutableMapOf()
                    )
                }
                
                item {
                    Spacer(modifier = Modifier.height(24.dp))
                    Button(onClick = { /* Save */ }, modifier = Modifier.fillMaxWidth()) {
                        Text("Guardar Cambios de Matriz")
                    }
                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
fun PositionRequirementCard(
    name: String,
    hours: List<Int>,
    hourValues: MutableMap<Int, Int>
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(name, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
            Spacer(modifier = Modifier.height(12.dp))
            
            hours.forEach { hour ->
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(String.format("%02d:00", hour), fontSize = 14.sp)
                    
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = { 
                                val current = hourValues[hour] ?: 0
                                if (current > 0) hourValues[hour] = current - 1
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.Remove, contentDescription = null, modifier = Modifier.size(16.dp))
                        }
                        
                        Text(
                            text = (hourValues[hour] ?: 0).toString(),
                            modifier = Modifier.padding(horizontal = 12.dp),
                            fontWeight = FontWeight.Bold
                        )
                        
                        IconButton(
                            onClick = { 
                                val current = hourValues[hour] ?: 0
                                hourValues[hour] = current + 1
                            },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        }
                    }
                }
                if (hour != hours.last()) HorizontalDivider(alpha = 0.3f)
            }
        }
    }
}
