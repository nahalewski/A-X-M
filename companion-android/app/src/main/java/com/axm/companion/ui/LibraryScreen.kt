package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.axm.companion.protocol.MediaState
import com.axm.companion.protocol.MusicListing

/**
 * The music on the PC and its drives, folder by folder, as A-X-M lists it. A tap
 * on a folder asks the host for that folder; a tap on a track plays it in the
 * menu (through whichever output is chosen). The phone never learns a path -
 * every folder and file is a key the host handed out with the listing.
 */
@Composable
fun LibraryScreen(
    listing: MusicListing?,
    media: MediaState,
    onBrowse: (String?) -> Unit,
    onPlay: (String) -> Unit,
    onBack: () -> Unit,
) {
    // First visit: the top of the library.
    LaunchedEffect(Unit) { if (listing == null) onBrowse(null) }

    Column(Modifier.fillMaxSize().background(Axm.Background).padding(22.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim,
                modifier = Modifier.clickable {
                    // Up a folder while there is one; out of the screen from the top.
                    val parent = listing?.parent
                    if (listing != null && listing.key.isNotEmpty()) onBrowse(parent?.ifEmpty { null }) else onBack()
                },
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(listing?.name ?: "Music", style = MaterialTheme.typography.titleLarge, color = Axm.Text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    if (media.title != null) "${if (media.playing) "Playing" else "Paused"} · ${media.title}" else "Pick a song to play it in A-X-M",
                    style = MaterialTheme.typography.bodyMedium, color = Axm.TextDim, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.height(16.dp))

        if (listing == null) {
            Text("Asking A-X-M for the library…", color = Axm.TextDim)
            return@Column
        }
        if (listing.entries.isEmpty()) {
            Text("Nothing here", color = Axm.TextDim)
            return@Column
        }
        LazyColumn(Modifier.fillMaxSize().clip(RoundedCornerShape(16.dp)).background(Axm.Panel)) {
            items(listing.entries, key = { it.key }) { e ->
                val nowPlaying = !e.folder && media.title == e.name
                Row(
                    Modifier.fillMaxWidth().clickable { if (e.folder) onBrowse(e.key) else onPlay(e.key) }
                        .padding(horizontal = 16.dp, vertical = 13.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        if (e.folder) Icons.Filled.Folder else Icons.Filled.MusicNote, null,
                        tint = if (nowPlaying) Axm.Accent else if (e.folder) Axm.TextDim else Axm.AccentDim,
                    )
                    Spacer(Modifier.width(14.dp))
                    Text(
                        e.name, color = if (nowPlaying) Axm.Accent else Axm.Text,
                        style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    if (nowPlaying) Text(if (media.playing) "▶" else "❚❚", color = Axm.Accent)
                }
            }
        }
    }
}
