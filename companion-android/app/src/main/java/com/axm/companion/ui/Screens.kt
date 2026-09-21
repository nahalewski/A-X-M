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
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.axm.companion.Screen
import com.axm.companion.net.LinkState
import com.axm.companion.protocol.DiscoveredHost
import com.axm.companion.protocol.MediaCommand
import com.axm.companion.protocol.MediaState
import com.axm.companion.protocol.XmbAction

/* ------------------------------------------------------------------ pieces -- */

@Composable
private fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
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
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(22.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("A-X-M", style = MaterialTheme.typography.titleLarge, color = Axm.Text)
        Text("COMPANION", style = MaterialTheme.typography.labelLarge, color = Axm.Accent)

        Panel(Modifier.fillMaxWidth()) {
            Column {
                Text("CONNECTED TO", style = MaterialTheme.typography.labelLarge, color = Axm.TextDim)
                Spacer(Modifier.height(8.dp))
                when (link) {
                    is LinkState.Connected -> {
                        Text(link.hostName, style = MaterialTheme.typography.titleMedium, color = Axm.Text)
                        Text("Connected", color = Axm.Good, style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.height(10.dp))
                        TextButton(onClick = onDisconnect) { Text("Disconnect", color = Axm.TextDim) }
                    }
                    is LinkState.Connecting -> Text("Connecting…", color = Axm.TextDim)
                    is LinkState.Failed -> Text(link.reason, color = Axm.Danger)
                    else -> Text("Not connected", color = Axm.TextDim)
                }
            }
        }

        // Only worth showing while there is nothing to control.
        if (link !is LinkState.Connected) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Found on this network", style = MaterialTheme.typography.labelLarge, color = Axm.TextDim)
                Spacer(Modifier.width(10.dp))
                Icon(
                    Icons.Filled.Refresh, "Search again", tint = if (scanning) Axm.AccentDim else Axm.Accent,
                    modifier = Modifier.size(20.dp).clickable(enabled = !scanning, onClick = onRefresh)
                )
            }
            if (hosts.isEmpty()) {
                Text(
                    if (scanning) "Searching…" else "Nothing found. Make sure A-X-M is running on the same Wi-Fi.",
                    color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
                )
            }
            hosts.forEach { host ->
                Panel(Modifier.fillMaxWidth().clickable { onConnect(host) }) {
                    Column {
                        Text(host.hostName, style = MaterialTheme.typography.titleMedium, color = Axm.Text)
                        Text("${host.address}  ·  ${host.hostVersion}", color = Axm.TextDim,
                            style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        if (link is LinkState.Connected) {
            Spacer(Modifier.height(4.dp))
            Text("MODES", style = MaterialTheme.typography.labelLarge, color = Axm.TextDim)
            ModeRow("Remote", "Navigate the menu") { onOpen(Screen.REMOTE) }
            ModeRow("Media", "What is playing") { onOpen(Screen.MEDIA) }
            ModeRow("Touchpad", "Move the pointer") { onOpen(Screen.TOUCHPAD) }
        }
    }
}

@Composable
private fun ModeRow(title: String, subtitle: String, onClick: () -> Unit) {
    Panel(Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Column {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Axm.Text)
            Text(subtitle, color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium)
        }
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
fun MediaScreen(media: MediaState, onCommand: (MediaCommand, Double?) -> Unit, onBack: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Axm.Background).padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Header("Media", onBack)

        Panel(Modifier.fillMaxWidth()) {
            Column {
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
                LinearProgressIndicator(
                    progress = { progress },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                    color = Axm.Accent,
                    trackColor = Axm.PanelRaised,
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

        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
        ) {
            PadButton(if (media.muted) Icons.AutoMirrored.Filled.VolumeOff else Icons.AutoMirrored.Filled.VolumeUp, "Mute", 56) {
                onCommand(MediaCommand.MUTE, null)
            }
            PadButton(Icons.Filled.Favorite, "Favourite", 56) { onCommand(MediaCommand.FAVORITE, null) }
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
