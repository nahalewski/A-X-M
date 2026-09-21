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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.axm.companion.protocol.CompanionSetting

/**
 * The menu's settings, as A-X-M lists them. This screen holds no settings of its
 * own: every row is one the host sent, showing the host's current value, and a
 * change goes straight back to the host, which applies it on the big screen and
 * lists again. Two phones and the TV therefore always agree.
 */
@Composable
fun SettingsScreen(
    items: List<CompanionSetting>,
    onSet: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Axm.Background).padding(22.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim,
                modifier = Modifier.clickable(onClick = onBack),
            )
            Spacer(Modifier.width(14.dp))
            Column {
                Text("A-X-M Settings", style = MaterialTheme.typography.titleLarge, color = Axm.Text)
                Text("Changes apply on the A-X-M screen", style = MaterialTheme.typography.bodyMedium, color = Axm.TextDim)
            }
        }
        Spacer(Modifier.height(18.dp))

        if (items.isEmpty()) {
            Text("Waiting for A-X-M to list its settings…", color = Axm.TextDim)
            return@Column
        }

        items.groupBy { it.group }.forEach { (group, rows) ->
            Text(group.uppercase(), style = MaterialTheme.typography.labelLarge, color = Axm.Accent)
            Spacer(Modifier.height(8.dp))
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Axm.Panel),
            ) {
                rows.forEach { s -> SettingRow(s, onSet) }
            }
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun SettingRow(s: CompanionSetting, onSet: (String, String) -> Unit) {
    var open by remember(s.id) { mutableStateOf(false) }
    val label = s.options.firstOrNull { it.first == s.value }?.second ?: s.value
    Column(Modifier.fillMaxWidth().clickable { if (s.kind == "choice") open = !open else onSet(s.id, if (s.value == "on") "off" else "on") }.padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(s.title, color = Axm.Text, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val sub = if (s.kind == "choice") label else s.detail
                if (sub != null) Text(sub, color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (s.kind == "toggle") {
                Switch(
                    checked = s.value == "on",
                    onCheckedChange = { onSet(s.id, if (it) "on" else "off") },
                    colors = SwitchDefaults.colors(checkedThumbColor = Axm.Background, checkedTrackColor = Axm.Accent, uncheckedTrackColor = Axm.PanelRaised),
                )
            } else {
                Text(if (open) "▲" else "▼", color = Axm.TextDim)
            }
        }
        if (open && s.kind == "choice") {
            Spacer(Modifier.height(8.dp))
            // A wrapped row of chips: the current one lit.
            FlowChips(s.options, s.value) { onSet(s.id, it); open = false }
        }
    }
}

@Composable
private fun FlowChips(options: List<Pair<String, String>>, current: String, onPick: (String) -> Unit) {
    // Rows of three keep long labels readable on a phone-width screen.
    options.chunked(3).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            row.forEach { (id, label) ->
                val active = id == current
                Box(
                    Modifier.weight(1f).clip(RoundedCornerShape(999.dp))
                        .background(if (active) Axm.Accent else Axm.PanelRaised)
                        .clickable { onPick(id) }.padding(vertical = 8.dp, horizontal = 6.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(label, color = if (active) Axm.Background else Axm.Text, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
        }
        Spacer(Modifier.height(8.dp))
    }
}
