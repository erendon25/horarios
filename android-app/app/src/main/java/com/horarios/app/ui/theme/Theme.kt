package com.horarios.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFECEFF1),
    secondary = Color(0xFFB0BEC5),
    tertiary = Color(0xFF78909C),
    background = Color(0xFF101214),
    surface = Color(0xFF101214),
    onPrimary = Color(0xFF101214),
    onSecondary = Color(0xFF101214),
    onTertiary = Color(0xFF101214),
    onBackground = Color(0xFFECEFF1),
    onSurface = Color(0xFFECEFF1),
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF263238),
    secondary = Color(0xFF455A64),
    tertiary = Color(0xFF607D8B),
    background = Color(0xFFFFFFFF),
    surface = Color(0xFFFFFFFF),
    onPrimary = Color(0xFFFFFFFF),
    onSecondary = Color(0xFFFFFFFF),
    onTertiary = Color(0xFFFFFFFF),
    onBackground = Color(0xFF263238),
    onSurface = Color(0xFF263238),
)

@Composable
fun HorariosTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
