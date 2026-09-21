package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.axm.companion.protocol.MediaCommand
import com.axm.companion.protocol.MediaState
import com.axm.companion.protocol.XmbAction

/**
 * One page for everything you press: the on-screen controller for the menu and
 * games, and the media transport. When the menu starts playing something the page
 * switches to the media controls by itself; the segmented toggle at the top
 * switches back, and a choice made by hand sticks until playback stops.
 */
@Composable
fun ControlsScreen(
    media: MediaState,
    onAction: (XmbAction) -> Unit,
    onCommand: (MediaCommand, Double?) -> Unit,
    onBack: () -> Unit,
    onRoute: ((Boolean) -> Unit)? = null,
) {
    val playingSomething = media.title != null
    // null = follow playback; true / false = the user chose.
    var forced by rememberSaveable { mutableStateOf<Boolean?>(null) }
    var lastPlaying by remember { mutableStateOf(playingSomething) }
    LaunchedEffect(playingSomething) {
        // Playback starting or stopping resets a manual choice, so the page follows
        // the menu again rather than staying stuck on the other set of buttons.
        if (playingSomething != lastPlaying) {
            forced = null
            lastPlaying = playingSomething
        }
    }
    val showMedia = forced ?: playingSomething

    Column(Modifier.fillMaxSize().background(Axm.Background)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 12.dp)
                .clip(RoundedCornerShape(999.dp)).background(Axm.Panel),
        ) {
            Segment("Controller", !showMedia, Modifier.weight(1f)) { forced = false }
            Segment(if (playingSomething) "Media · playing" else "Media", showMedia, Modifier.weight(1f)) { forced = true }
        }
        Box(Modifier.fillMaxSize()) {
            if (showMedia) MediaScreen(media = media, onCommand = onCommand, onBack = onBack, onRoute = onRoute)
            else RemoteScreen(onAction = onAction, onBack = onBack)
        }
    }
}

@Composable
private fun Segment(label: String, active: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) Axm.Accent else Axm.Panel)
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (active) Axm.Background else Axm.TextDim,
            style = MaterialTheme.typography.labelLarge,
        )
    }
}
