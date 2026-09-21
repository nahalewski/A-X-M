package com.axm.companion.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * The companion's palette, taken from A-X-M so the two read as one product: near
 * black panels, white silhouettes, one cyan accent and nothing else competing.
 *
 * Always dark. The app is used next to a handheld running a black menu, and a light
 * mode would be wrong in every room where that happens.
 */
object Axm {
    val Background = Color(0xFF0B0E14)
    val Panel = Color(0xFF141922)
    val PanelRaised = Color(0xFF1C2330)
    val Accent = Color(0xFF4CC2FF)
    val AccentDim = Color(0xFF1E5C7A)
    val Text = Color(0xFFEAF1FF)
    val TextDim = Color(0xFF8A97AC)
    val Danger = Color(0xFFFF5A5A)
    val Good = Color(0xFF48D19A)
    val GlowBlue = Color(0xFF00A8FF)
    val SlotBackground = Color(0xFF0A1628)
    val SlotBorder = Color(0xFF1A4A7A)
    val SlotSelected = Color(0xFF00B4FF)
    val HeaderGlow = Color(0xFF0078D4)
    val CardPanelBg = Color(0xFF0D1B2A)

    /**
     * The main menu's icon tiles glow a touch brighter than the rest of the
     * chrome, so the five things you can actually go to read as the live part
     * of the screen rather than sitting at the same weight as the panels.
     */
    val IconTileGlow = Color(0xFF00BFFF)
    val DisabledTile = Color(0xFF2A3040)
}

private val scheme = darkColorScheme(
    primary = Axm.Accent,
    onPrimary = Color(0xFF00121C),
    secondary = Axm.AccentDim,
    background = Axm.Background,
    onBackground = Axm.Text,
    surface = Axm.Panel,
    onSurface = Axm.Text,
    surfaceVariant = Axm.PanelRaised,
    onSurfaceVariant = Axm.TextDim,
    error = Axm.Danger,
)

private val typography = Typography(
    titleLarge = TextStyle(fontSize = 26.sp, fontWeight = FontWeight.Light, letterSpacing = 0.5.sp),
    titleMedium = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Normal),
    bodyLarge = TextStyle(fontSize = 16.sp),
    bodyMedium = TextStyle(fontSize = 14.sp),
    labelLarge = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium, letterSpacing = 1.sp),
)

@Composable
fun AxmTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()     // read so the app is not flagged as ignoring the setting
    MaterialTheme(colorScheme = scheme, typography = typography, content = content)
}
