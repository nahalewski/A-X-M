package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.axm.companion.protocol.SaveListing
import com.axm.companion.protocol.SavePatches
import com.axm.companion.protocol.SaveResult
import com.axm.companion.saves.SaveStore

/**
 * Memory card saves: what's on A-X-M's cards (when connected) and the copies this
 * phone keeps (always). A save opens a small action panel: get or refresh the
 * copy, send it back onto the card, Apollo's cheats, undo the last edit, delete
 * the local copy. The host does every write; the phone only ever asks.
 */
@Composable
fun SavesScreen(
    listing: SaveListing?,
    local: List<SaveStore.LocalSave>,
    connected: Boolean,
    result: SaveResult?,
    onFetch: (String, String) -> Unit,
    onPush: (String, String) -> Unit,
    onCheats: (String, String) -> Unit,
    onUndo: (String, String) -> Unit,
    onDelete: (String, String) -> Unit,
    onClearResult: () -> Unit,
    onBack: () -> Unit,
) {
    var open by remember { mutableStateOf<Pair<String, String>?>(null) }
    Column(Modifier.fillMaxSize().background(Axm.Background).padding(22.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(14.dp))
            Column {
                Text("Memory Card Saves", style = MaterialTheme.typography.titleLarge, color = Axm.Text)
                Text(if (connected) "A-X-M's cards, and the copies on this phone" else "Offline · the copies on this phone", style = MaterialTheme.typography.bodyMedium, color = Axm.TextDim)
            }
        }
        Spacer(Modifier.height(16.dp))

        if (result != null) {
            Panel(Modifier.fillMaxWidth()) {
                Column {
                    Text(if (result.ok) "Done" else "Not done", color = if (result.ok) Axm.Good else Axm.Danger, style = MaterialTheme.typography.labelLarge)
                    Text(result.message, color = Axm.Text)
                    if (result.preview.isNotEmpty()) Text(result.preview.joinToString("\n"), color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onClearResult) { Text("OK", color = Axm.Accent) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }

        val localBy = local.associateBy { it.cardId to it.save }
        if (connected && listing != null) {
            for (card in listing.cards) {
                Text("${card.name.uppercase()} · ${if (card.kind == "ps1") "PS" else "PS2"}", style = MaterialTheme.typography.labelLarge, color = Axm.Accent)
                Spacer(Modifier.height(8.dp))
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Axm.Panel)) {
                    if (card.saves.isEmpty()) Text("No saves on this card", color = Axm.TextDim, modifier = Modifier.padding(16.dp))
                    for (s in card.saves) {
                        val copy = localBy[card.id to s.name]
                        val fresh = copy != null && copy.sha1 == s.sha1
                        val isOpen = open == (card.id to s.name)
                        Column(Modifier.fillMaxWidth().clickable { open = if (isOpen) null else card.id to s.name }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                            Text(s.title, color = Axm.Text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                "${s.name} · ${s.size / 1024} KB · " + when { fresh -> "copy on this phone"; copy != null -> "phone copy is older"; else -> "no copy yet" },
                                color = if (fresh) Axm.Good else Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
                            )
                            if (isOpen) SaveActions(
                                hasCopy = copy != null,
                                onFetch = { onFetch(card.id, s.name) }, onPush = { onPush(card.id, s.name) },
                                onCheats = { onCheats(card.id, s.name) }, onUndo = { onUndo(card.id, s.name) }, onDelete = { onDelete(card.id, s.name); open = null },
                            )
                        }
                    }
                }
                Spacer(Modifier.height(18.dp))
            }
        }

        Text("ON THIS PHONE", style = MaterialTheme.typography.labelLarge, color = Axm.Accent)
        Spacer(Modifier.height(8.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Axm.Panel)) {
            if (local.isEmpty()) Text("No copies yet. Connect to A-X-M and they come over on their own, or Send a copy to the phone from the Memory Card Utility.", color = Axm.TextDim, modifier = Modifier.padding(16.dp))
            for (l in local) {
                val isOpen = open == (l.cardId to l.save)
                Column(Modifier.fillMaxWidth().clickable { open = if (isOpen) null else l.cardId to l.save }.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Text(l.title, color = Axm.Text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${l.save} · ${l.fileName} · ${l.size / 1024} KB · ${l.at.take(16).replace('T', ' ')}", color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium)
                    if (isOpen) SaveActions(
                        hasCopy = true, offline = !connected,
                        onFetch = { onFetch(l.cardId, l.save) }, onPush = { onPush(l.cardId, l.save) },
                        onCheats = { onCheats(l.cardId, l.save) }, onUndo = { onUndo(l.cardId, l.save) }, onDelete = { onDelete(l.cardId, l.save); open = null },
                    )
                }
            }
        }
    }
}

@Composable
private fun SaveActions(hasCopy: Boolean, offline: Boolean = false, onFetch: () -> Unit, onPush: () -> Unit, onCheats: () -> Unit, onUndo: () -> Unit, onDelete: () -> Unit) {
    Spacer(Modifier.height(8.dp))
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (!offline) {
            ActionChip(if (hasCopy) "Refresh the copy from the card" else "Get a copy onto this phone", onFetch)
            if (hasCopy) ActionChip("Put this copy back on the card", onPush)
            ActionChip("Edit Save · Apollo Cheats", onCheats)
            ActionChip("Undo last edit on the card", onUndo)
        } else {
            Text("Connect to A-X-M to put this back, edit it, or refresh it.", color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
        }
        if (hasCopy) ActionChip("Delete the copy on this phone", onDelete, danger = true)
    }
}

@Composable
private fun ActionChip(label: String, onClick: () -> Unit, danger: Boolean = false) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(Axm.PanelRaised).clickable(onClick = onClick).padding(vertical = 9.dp, horizontal = 14.dp),
    ) { Text(label, color = if (danger) Axm.Danger else Axm.Accent, style = MaterialTheme.typography.labelLarge) }
}

/**
 * Apollo Cheats for one save, as the host lists them: the same codes, in the
 * same order, with the same option values as the TV's sidebar. Ticks and picks
 * go to the host as a selection; it previews or applies and answers.
 */
@Composable
fun CheatsScreen(
    patches: SavePatches?,
    result: SaveResult?,
    onApply: (List<Pair<String, Map<String, String>>>, Boolean) -> Unit,
    onClearResult: () -> Unit,
    onBack: () -> Unit,
) {
    val selected = remember(patches) { mutableStateMapOf<String, Map<String, String>>().also { m -> patches?.codes?.filter { it.isDefault && !it.isInfo }?.forEach { c -> m[c.key] = c.options.associate { o -> o.tag to (o.choices.firstOrNull()?.first ?: "") } } } }
    Column(Modifier.fillMaxSize().background(Axm.Background).padding(22.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(14.dp))
            Column {
                Text("Apollo Cheats", style = MaterialTheme.typography.titleLarge, color = Axm.Text)
                Text(patches?.let { "${it.gameName ?: it.productCode}${if (it.region.isNotEmpty()) " · ${it.region}" else ""}" } ?: "Asking A-X-M…", style = MaterialTheme.typography.bodyMedium, color = Axm.TextDim)
            }
        }
        Spacer(Modifier.height(14.dp))
        if (result != null) {
            Panel(Modifier.fillMaxWidth()) {
                Column {
                    Text(if (result.ok) "Done" else "Not done", color = if (result.ok) Axm.Good else Axm.Danger, style = MaterialTheme.typography.labelLarge)
                    Text(result.message, color = Axm.Text)
                    if (result.preview.isNotEmpty()) Text(result.preview.joinToString("\n"), color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
                    TextButton(onClick = onClearResult) { Text("OK", color = Axm.Accent) }
                }
            }
            Spacer(Modifier.height(12.dp))
        }
        val p = patches
        if (p == null) return@Column
        if (p.error != null) { Text(p.error, color = Axm.Danger); return@Column }
        if (p.codes.isEmpty()) { Text("No patches in the Apollo database for ${p.productCode}.", color = Axm.TextDim); return@Column }

        var group: String? = null
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Axm.Panel)) {
            for (c in p.codes) {
                if (c.group != group) {
                    group = c.group
                    if (group != null) Text(group!!.uppercase(), color = Axm.Accent, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
                }
                if (c.isInfo) { Text("ⓘ ${c.name}", color = Axm.TextDim, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)); continue }
                val on = selected.containsKey(c.key)
                Column(Modifier.fillMaxWidth().clickable {
                    if (on) selected.remove(c.key) else selected[c.key] = c.options.associate { o -> o.tag to (o.choices.firstOrNull()?.first ?: "") }
                }.padding(horizontal = 12.dp, vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = on, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = Axm.Accent, uncheckedColor = Axm.TextDim))
                        Column(Modifier.weight(1f)) {
                            Text(c.name, color = Axm.Text, style = MaterialTheme.typography.bodyLarge)
                            Text(listOf(if (c.isRequired) "required · added with any other" else "", c.targets.joinToString(", ")).filter { it.isNotEmpty() }.joinToString(" · "), color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    if (on) for (o in c.options) {
                        Row(Modifier.padding(start = 44.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            for ((value, label) in o.choices) {
                                val active = selected[c.key]?.get(o.tag) == value
                                Box(Modifier.clip(RoundedCornerShape(999.dp)).background(if (active) Axm.Accent else Axm.PanelRaised).clickable { selected[c.key] = (selected[c.key] ?: emptyMap()) + (o.tag to value) }.padding(vertical = 6.dp, horizontal = 10.dp)) {
                                    Text(label, color = if (active) Axm.Background else Axm.Text, style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        val list = { selected.entries.map { it.key to it.value } }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.weight(1f).clip(RoundedCornerShape(999.dp)).background(Axm.PanelRaised).clickable(enabled = selected.isNotEmpty()) { onApply(list(), true) }.padding(vertical = 12.dp), contentAlignment = Alignment.Center) { Text("Preview Changes", color = Axm.Text, style = MaterialTheme.typography.labelLarge) }
            Box(Modifier.weight(1f).clip(RoundedCornerShape(999.dp)).background(if (selected.isNotEmpty()) Axm.Accent else Axm.PanelRaised).clickable(enabled = selected.isNotEmpty()) { onApply(list(), false) }.padding(vertical = 12.dp), contentAlignment = Alignment.Center) { Text("Apply Selected", color = if (selected.isNotEmpty()) Axm.Background else Axm.TextDim, style = MaterialTheme.typography.labelLarge) }
        }
        Spacer(Modifier.height(10.dp))
        Text("The card is backed up on A-X-M before every apply · ${p.attribution.joinToString(" · ")}", color = Axm.TextDim, style = MaterialTheme.typography.bodySmall)
    }
}
