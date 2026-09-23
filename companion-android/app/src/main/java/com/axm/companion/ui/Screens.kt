package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FastForward
import androidx.compose.material.icons.filled.FastRewind
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.SdCard
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.PhoneAndroid
import androidx.compose.material.icons.filled.SportsEsports
import androidx.compose.material.icons.filled.VideoLibrary
import androidx.compose.material.icons.filled.Wifi
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import com.axm.companion.Screen
import com.axm.companion.protocol.CompanionSetting
import com.axm.companion.net.LinkState
import com.axm.companion.protocol.DiscoveredHost
import com.axm.companion.protocol.MediaCommand
import com.axm.companion.protocol.MediaState
import com.axm.companion.protocol.XmbAction

/* ------------------------------------------------------------------ pieces -- */

@Composable
fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Axm.Panel)
            .border(1.dp, Axm.PanelRaised, RoundedCornerShape(18.dp))
            .padding(18.dp)
    ) { content() }
}

/** A big round control. Sized for a thumb, because this is used without looking. */
@Composable
private fun PadButton(
    icon: ImageVector,
    label: String,
    size: Int = 72,
    accent: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(size.dp)
            .clip(CircleShape)
            .background(if (accent) Axm.AccentDim else Axm.PanelRaised)
            .border(1.dp, if (accent) Axm.Accent else Axm.Panel, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, label, tint = if (accent) Axm.Accent else Axm.Text, modifier = Modifier.size((size / 2.4).dp))
    }
}

@Composable
private fun Header(title: String, onBack: (() -> Unit)? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        if (onBack != null) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim,
                modifier = Modifier.size(26.dp).clickable(onClick = onBack)
            )
            Spacer(Modifier.width(14.dp))
        }
        Text(title, style = MaterialTheme.typography.titleLarge, color = Axm.Text)
    }
}

/* -------------------------------------------------------------------- home -- */

@Composable
fun HomeScreen(
    link: LinkState,
    hosts: List<DiscoveredHost>,
    scanning: Boolean,
    onRefresh: () -> Unit,
    onConnect: (DiscoveredHost) -> Unit,
    onDisconnect: () -> Unit,
    onOpen: (Screen) -> Unit,
) {
    val connected = link is LinkState.Connected

    // Set when a dimmed tile is tapped, and cleared again a moment later so the
    // hint behaves like a toast without pulling in a Scaffold and a snackbar
    // host just for one line of text.
    var blockedHint by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(blockedHint) {
        if (blockedHint != null) {
            delay(2600)
            blockedHint = null
        }
    }
    // Connecting makes the hint stale, so it goes as soon as the link comes up.
    LaunchedEffect(connected) {
        if (connected) blockedHint = null
    }

    Column(Modifier.fillMaxSize().background(Axm.Background)) {
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Spacer(Modifier.height(8.dp))

            // ---- A-X-M COMPANION header ----
            Column {
                Text(
                    "A - X - M",
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontSize = 32.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp,
                    ),
                    color = Axm.GlowBlue,
                )
                Text(
                    "COMPANION",
                    style = MaterialTheme.typography.labelLarge.copy(letterSpacing = 6.sp),
                    color = Axm.Accent,
                )
            }

            // ---- Connection bar ----
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                    .border(1.dp, Axm.GlowBlue.copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                    .background(Axm.CardPanelBg)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                when (link) {
                    is LinkState.Connected -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Connected to:", color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
                                Text(link.hostName, color = Axm.Text, style = MaterialTheme.typography.titleMedium)
                            }
                            TextButton(onClick = onDisconnect) {
                                Text("Disconnect", color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                    is LinkState.Connecting -> Text("Connecting…", color = Axm.Accent, style = MaterialTheme.typography.bodyMedium)
                    is LinkState.Failed -> Text(link.reason, color = Axm.Danger, style = MaterialTheme.typography.bodyMedium)
                    else -> Text("Not connected", color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium)
                }
            }

            // ---- Host discovery (only when disconnected) ----
            if (link !is LinkState.Connected) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Found on this network", style = MaterialTheme.typography.labelLarge, color = Axm.TextDim)
                    Spacer(Modifier.width(10.dp))
                    Icon(
                        Icons.Filled.Refresh, "Search again",
                        tint = if (scanning) Axm.AccentDim else Axm.Accent,
                        modifier = Modifier.size(20.dp).clickable(enabled = !scanning, onClick = onRefresh),
                    )
                }
                if (hosts.isEmpty()) {
                    Text(
                        if (scanning) "Searching…"
                        else "Nothing found. Make sure A-X-M is running on the same Wi-Fi.",
                        color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
                    )
                }
                hosts.forEach { host ->
                    Box(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Axm.SlotBorder, RoundedCornerShape(12.dp))
                            .background(Axm.SlotBackground)
                            .clickable { onConnect(host) }.padding(16.dp),
                    ) {
                        Column {
                            Text(host.hostName, style = MaterialTheme.typography.titleMedium, color = Axm.Text)
                            Text(
                                "${host.address}  ·  ${host.hostVersion}",
                                color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))

            // ---- Mode icon grid ----
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                val columns = if (maxWidth > 600.dp) 5 else 3
                val items = listOf(
                    Triple(Icons.Filled.SportsEsports, "Controls", Screen.REMOTE),
                    Triple(Icons.Filled.VideoLibrary, "Media", Screen.MEDIA),
                    Triple(Icons.Filled.MusicNote, "Music\nLibrary", Screen.LIBRARY),
                    Triple(Icons.Filled.SdCard, "Memory Card\nSaves", Screen.SAVES),
                    Triple(Icons.Filled.Settings, "A-X-M\nSettings", Screen.SETTINGS),
                    Triple(Icons.Filled.PhoneAndroid, "Device\nSharing", Screen.DEVICE),
                )

                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items.chunked(columns).forEach { row ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            row.forEach { (icon, label, screen) ->
                                // Saves and Device Sharing work offline: copies and switches live on the phone.
                                val enabled = connected || screen == Screen.SAVES || screen == Screen.DEVICE
                                ModeIconTile(
                                    icon = icon, label = label, enabled = enabled,
                                    modifier = Modifier.weight(1f),
                                    onClick = { onOpen(screen) },
                                    onBlocked = { blockedHint = "Connect to A-X-M first" },
                                )
                            }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }

            // Why a dimmed tile did nothing. Saves works offline because the
            // phone keeps its own copies; everything else needs the host.
            AnimatedVisibility(
                visible = blockedHint != null,
                enter = fadeIn(),
                exit = fadeOut(),
            ) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                        .border(1.dp, Axm.Accent.copy(alpha = 0.4f), RoundedCornerShape(10.dp))
                        .background(Axm.PanelRaised)
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Filled.Info, null, tint = Axm.Accent, modifier = Modifier.size(18.dp))
                    Text(
                        blockedHint ?: "",
                        color = Axm.Text,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }

            Spacer(Modifier.height(8.dp))

            // ---- Connection indicator ----
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                    .background(Axm.Panel).padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Info, "Info", tint = Axm.TextDim, modifier = Modifier.size(20.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Icon(
                        if (connected) Icons.Filled.Wifi else Icons.Filled.WifiOff,
                        "Connection",
                        tint = if (connected) Axm.Good else Axm.TextDim,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        if (connected) "Connected" else "Disconnected",
                        color = if (connected) Axm.Good else Axm.TextDim,
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    if (connected) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(Axm.Good))
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
        }

        // ---- Fixed bottom: PS button hints ----
        //
        // Just the four hints, spread across the bar. The wordmark that used to
        // sit on the right is gone: the header already says A-X-M COMPANION, and
        // at phone width it collided with the Menu hint rather than wrapping.
        Row(
            Modifier.fillMaxWidth().background(Axm.Panel)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HomePsHint("\u2715", Color(0xFF5B8EF0), "Select")
            HomePsHint("\u25CB", Color(0xFFEF5350), "Back")
            HomePsHint("\u25B3", Color(0xFF66BB6A), "Options")
            HomePsHint("\u25A1", Color(0xFFEC407A), "Menu")
        }
    }
}

@Composable
private fun ModeIconTile(
    icon: ImageVector,
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onBlocked: () -> Unit = {},
) {
    val borderColor = if (enabled) Axm.IconTileGlow else Axm.SlotBorder.copy(alpha = 0.4f)
    val bgColor = if (enabled) Axm.SlotBackground else Axm.DisabledTile
    Box(
        modifier.aspectRatio(1f).clip(RoundedCornerShape(14.dp))
            .border(if (enabled) 1.5.dp else 0.75.dp, borderColor, RoundedCornerShape(14.dp))
            .background(bgColor)
            // A dimmed tile still takes the tap, so it can say why it is dimmed.
            // Making it unclickable instead leaves the screen looking broken:
            // you press it, nothing happens, and nothing tells you what to do.
            .clickable { if (enabled) onClick() else onBlocked() }
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Icon(
                icon, label,
                tint = if (enabled) Axm.IconTileGlow else Axm.TextDim.copy(alpha = 0.3f),
                modifier = Modifier.size(36.dp),
            )
            Spacer(Modifier.height(6.dp))
            Text(
                label,
                color = if (enabled) Axm.Text else Axm.TextDim.copy(alpha = 0.3f),
                style = MaterialTheme.typography.bodySmall,
                textAlign = TextAlign.Center, maxLines = 2,
            )
        }
    }
}

@Composable
private fun HomePsHint(symbol: String, color: Color, label: String) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Box(
            Modifier.size(18.dp).border(1.5.dp, color, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(symbol, color = color, fontSize = 9.sp, textAlign = TextAlign.Center)
        }
        Text(label, color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
    }
}

/* ----------------------------------------------------------------- pairing -- */

@Composable
fun PairingScreen(state: LinkState.NeedsPairing, onSubmit: (String) -> Unit, onCancel: () -> Unit) {
    var code by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(26.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(40.dp))
        Text("Pair with ${state.hostName}", style = MaterialTheme.typography.titleLarge, color = Axm.Text,
            textAlign = TextAlign.Center)
        Text(
            "A-X-M is showing a four digit code on its screen. Type it here.",
            color = Axm.TextDim, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge,
        )

        OutlinedTextField(
            value = code,
            onValueChange = { if (it.length <= 4 && it.all(Char::isDigit)) code = it },
            label = { Text("Code") },
            singleLine = true,
        )

        state.error?.let { Text(it, color = Axm.Danger, textAlign = TextAlign.Center) }
        state.attemptsLeft?.let {
            Text("$it attempts left", color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium)
        }

        Button(onClick = { onSubmit(code) }, enabled = code.length == 4) { Text("Pair") }
        TextButton(onClick = onCancel) { Text("Cancel", color = Axm.TextDim) }
    }
}

/* ------------------------------------------------------------------ remote -- */

@Composable
fun RemoteScreen(onAction: (XmbAction) -> Unit, onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Header("Remote", onBack)

        // The swipe surface is the primary control and the d-pad is the backup:
        // flicking through a horizontal menu is what this actually gets used for.
        Panel(Modifier.fillMaxWidth().height(180.dp)) {
            Box(
                Modifier.fillMaxSize().pointerInput(Unit) {
                    var dx = 0f
                    var dy = 0f
                    detectDragGestures(
                        onDragStart = { dx = 0f; dy = 0f },
                        onDragEnd = {
                            // One gesture is one move, so a flick does not scroll
                            // the menu halfway across the library.
                            val threshold = 60f
                            when {
                                kotlin.math.abs(dx) > kotlin.math.abs(dy) && dx > threshold -> onAction(XmbAction.RIGHT)
                                kotlin.math.abs(dx) > kotlin.math.abs(dy) && dx < -threshold -> onAction(XmbAction.LEFT)
                                dy > threshold -> onAction(XmbAction.DOWN)
                                dy < -threshold -> onAction(XmbAction.UP)
                            }
                        },
                    ) { change, drag ->
                        change.consume()
                        dx += drag.x
                        dy += drag.y
                    }
                }.pointerInput(Unit) {
                    detectTapGestures(onTap = { onAction(XmbAction.CONFIRM) })
                },
                contentAlignment = Alignment.Center,
            ) {
                Text("Swipe to move  ·  Tap to select", color = Axm.TextDim,
                    style = MaterialTheme.typography.bodyMedium)
            }
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
            PadButton(Icons.Filled.KeyboardArrowUp, "Up") { onAction(XmbAction.UP) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                PadButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Left") { onAction(XmbAction.LEFT) }
                PadButton(Icons.Filled.PlayArrow, "Select", accent = true) { onAction(XmbAction.CONFIRM) }
                PadButton(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Right") { onAction(XmbAction.RIGHT) }
            }
            PadButton(Icons.Filled.KeyboardArrowDown, "Down") { onAction(XmbAction.DOWN) }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = { onAction(XmbAction.BACK) }) { Text("Back", color = Axm.Text) }
            TextButton(onClick = { onAction(XmbAction.CONTEXT) }) { Text("Options", color = Axm.Text) }
            TextButton(onClick = { onAction(XmbAction.GUIDE) }) { Text("Home", color = Axm.Text) }
        }
    }
}

/* ------------------------------------------------------------------- media -- */

@Composable
fun MediaScreen(
    media: MediaState,
    onCommand: (MediaCommand, Double?) -> Unit,
    onBack: () -> Unit,
    onRoute: ((Boolean) -> Unit)? = null,
    visualizer: CompanionSetting? = null,
    onVisualizer: ((String) -> Unit)? = null,
    onLibrary: (() -> Unit)? = null,
) {
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Header("Media", onBack)

        // The artwork the host sent (a cover, a poster): a modest square, centred.
        if (media.artworkUrl != null) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                RemoteImage(media.artworkUrl, Modifier.size(150.dp).clip(RoundedCornerShape(14.dp)))
            }
        }

        Panel(Modifier.fillMaxWidth()) {
            Column {
                Text(
                    if (media.playing) "Now playing" else if (media.title != null) "Paused" else "",
                    color = Axm.Accent, style = MaterialTheme.typography.labelMedium,
                )
                Text(
                    media.title ?: "Nothing playing",
                    style = MaterialTheme.typography.titleMedium, color = Axm.Text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                media.artist?.let {
                    Text(it, color = Axm.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                media.album?.let {
                    Text(it, color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                Spacer(Modifier.height(14.dp))
                val progress = if (media.durationSeconds > 0)
                    (media.positionSeconds / media.durationSeconds).toFloat().coerceIn(0f, 1f) else 0f
                // Drag to scrub: the bar follows the finger while held, and the new
                // position goes to the menu once it lets go.
                var dragging by remember { mutableStateOf<Float?>(null) }
                Slider(
                    value = dragging ?: progress,
                    onValueChange = { dragging = it },
                    onValueChangeFinished = {
                        val at = dragging
                        dragging = null
                        if (at != null && media.durationSeconds > 0) onCommand(MediaCommand.POSITION, (at * media.durationSeconds))
                    },
                    enabled = media.durationSeconds > 0,
                    modifier = Modifier.fillMaxWidth(),
                    colors = SliderDefaults.colors(thumbColor = Axm.Accent, activeTrackColor = Axm.Accent, inactiveTrackColor = Axm.PanelRaised),
                )
                Spacer(Modifier.height(6.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(clock(media.positionSeconds), color = Axm.TextDim,
                        style = MaterialTheme.typography.bodyMedium)
                    Text(clock(media.durationSeconds), color = Axm.TextDim,
                        style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PadButton(Icons.Filled.SkipPrevious, "Previous", 60) { onCommand(MediaCommand.PREVIOUS, null) }
            PadButton(Icons.Filled.FastRewind, "Back", 60) { onCommand(MediaCommand.SEEK, -15.0) }
            PadButton(
                if (media.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                if (media.playing) "Pause" else "Play", 84, accent = true,
            ) { onCommand(MediaCommand.TOGGLE, null) }
            PadButton(Icons.Filled.FastForward, "Forward", 60) { onCommand(MediaCommand.SEEK, 15.0) }
            PadButton(Icons.Filled.SkipNext, "Next", 60) { onCommand(MediaCommand.NEXT, null) }
        }

        // Where the sound comes out. The phone's own routing (headphones, Bluetooth,
        // a car) applies whenever the phone has it.
        if (onRoute != null && media.streamUrl != null) {
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(Axm.Panel),
            ) {
                OutputChoice("This PC", media.output != "phone", Modifier.weight(1f)) { onRoute(false) }
                OutputChoice("Phone", media.output == "phone", Modifier.weight(1f)) { onRoute(true) }
            }
        }

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        ) {
            PadButton(if (media.muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp, "Mute", 56) {
                onCommand(MediaCommand.MUTE, null)
            }
            PadButton(Icons.Filled.Favorite, "Favourite", 56) { onCommand(MediaCommand.FAVORITE, null) }
        }

        // The menu's visualizer, switched from here: ◀ ▶ step through the styles
        // the host listed, the same list ◀ ▶ walk on the stage.
        if (visualizer != null && onVisualizer != null && visualizer.options.isNotEmpty()) {
            val i = visualizer.options.indexOfFirst { it.first == visualizer.value }.coerceAtLeast(0)
            val n = visualizer.options.size
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(Axm.Panel).padding(horizontal = 6.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PadButton(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous style", 40) { onVisualizer(visualizer.options[(i - 1 + n) % n].first) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("VISUALIZER", style = MaterialTheme.typography.labelMedium, color = Axm.TextDim)
                    Text(visualizer.options[i].second, color = Axm.Text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                PadButton(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next style", 40) { onVisualizer(visualizer.options[(i + 1) % n].first) }
            }
        }

        if (onLibrary != null) {
            Box(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(Axm.PanelRaised).clickable(onClick = onLibrary).padding(vertical = 12.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text("Browse the music library", color = Axm.Accent, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

private fun clock(seconds: Double): String {
    if (seconds <= 0 || seconds.isNaN()) return "0:00"
    val total = seconds.toInt()
    return "%d:%02d".format(total / 60, total % 60)
}

/* ---------------------------------------------------------------- touchpad -- */

@Composable
fun TouchpadScreen(
    onPointer: (String, Float, Float, String?) -> Unit,
    onBack: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Header("Touchpad", onBack)

        Panel(Modifier.fillMaxWidth().aspectRatio(0.85f)) {
            Box(
                Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectDragGestures { change, drag ->
                            change.consume()
                            // Deltas, never absolute positions, so the phone's
                            // resolution never has to match the screen's.
                            onPointer("move", drag.x, drag.y, null)
                        }
                    }
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { onPointer("click", 0f, 0f, "left") },
                            onLongPress = { onPointer("click", 0f, 0f, "right") },
                        )
                    },
                contentAlignment = Alignment.Center,
            ) {
                Text("Drag to move  ·  Tap to click  ·  Hold to right click",
                    color = Axm.TextDim, textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodyMedium)
            }
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Button(onClick = { onPointer("click", 0f, 0f, "left") }, modifier = Modifier.weight(1f)) {
                Text("Left")
            }
            Button(onClick = { onPointer("click", 0f, 0f, "right") }, modifier = Modifier.weight(1f)) {
                Text("Right")
            }
        }
    }
}

@Composable
private fun OutputChoice(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(999.dp)).background(if (active) Axm.Accent else Axm.Panel).clickable(onClick = onClick).padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (active) Axm.Background else Axm.TextDim, style = MaterialTheme.typography.labelLarge)
    }
}
