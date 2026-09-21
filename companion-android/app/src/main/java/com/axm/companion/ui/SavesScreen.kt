package com.axm.companion.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.SdCard
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.axm.companion.protocol.SaveCard
import com.axm.companion.protocol.SaveListing
import com.axm.companion.protocol.SavePatches
import com.axm.companion.protocol.SaveResult
import com.axm.companion.saves.SaveStore

/* ====== Internal data model for the slot grid ====== */

private data class SlotInfo(
    val number: Int,
    val cardId: String,
    val saveName: String?,
    val title: String,
    val size: Long,
    val kind: String,
    val hasLocal: Boolean,
    val localFresh: Boolean,
    val localDate: String?,
)

/* ========================================================================== */
/*  SavesScreen – PS2-style Memory Card Manager                               */
/* ========================================================================== */

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
    val localBy = local.associateBy { it.cardId to it.save }
    val cards = if (connected && listing != null) listing.cards else emptyList()

    var selectedCardIdx by remember { mutableStateOf(0) }
    var selectedSlot by remember { mutableStateOf<SlotInfo?>(null) }

    // Clamp card index when the listing changes
    val clampedIdx = selectedCardIdx.coerceIn(0, maxOf(0, cards.size - 1))
    if (clampedIdx != selectedCardIdx) { selectedCardIdx = clampedIdx; selectedSlot = null }

    val currentCard = cards.getOrNull(selectedCardIdx)

    // Build the slot list for the current view
    val slots = remember(currentCard, local, listing) {
        if (currentCard != null) {
            val minSlots = if (currentCard.kind == "ps1") 15 else 16
            val count = maxOf(minSlots, currentCard.saves.size)
            (1..count).map { i ->
                val save = currentCard.saves.getOrNull(i - 1)
                if (save != null) {
                    val loc = localBy[currentCard.id to save.name]
                    SlotInfo(i, currentCard.id, save.name, save.title.ifEmpty { save.name },
                        save.size, currentCard.kind, loc != null,
                        loc != null && loc.sha1 == save.sha1, loc?.at?.take(10))
                } else {
                    SlotInfo(i, currentCard.id, null, "No Data", 0, currentCard.kind,
                        false, false, null)
                }
            }
        } else {
            // Offline: local saves as numbered slots
            local.mapIndexed { i, l ->
                SlotInfo(i + 1, l.cardId, l.save, l.title.ifEmpty { l.save },
                    l.size, l.kind, true, true, l.at.take(10))
            }
        }
    }

    Column(Modifier.fillMaxSize().background(Axm.Background)) {

        // ---- Header ----
        MemCardHeader(connected, cards.size, onBack)

        // ---- Main content ----
        BoxWithConstraints(Modifier.weight(1f)) {
            val isWide = maxWidth > 600.dp
            val gridColumns = if (isWide) 5 else 4

            if (isWide) {
                // ===== Wide / Landscape / Foldable =====
                Row(Modifier.fillMaxSize()) {
                    MemCardActionSidebar(
                        selectedSlot, connected,
                        onFetch, onPush, onCheats, onUndo, onDelete, onBack,
                        Modifier.width(130.dp).fillMaxHeight(),
                    )
                    Column(
                        Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp),
                    ) {
                        if (result != null) {
                            MemCardResultBanner(result, onClearResult)
                            Spacer(Modifier.height(8.dp))
                        }
                        if (cards.size > 1) {
                            MemCardTabs(cards, selectedCardIdx) { selectedCardIdx = it; selectedSlot = null }
                            Spacer(Modifier.height(8.dp))
                        }
                        if (slots.isEmpty()) {
                            Text(
                                if (connected) "No saves on this card"
                                else "No copies on this phone yet.",
                                color = Axm.TextDim, modifier = Modifier.padding(16.dp),
                            )
                        } else {
                            MemCardSlotGrid(slots, selectedSlot, gridColumns) { slot ->
                                selectedSlot = if (selectedSlot == slot) null else slot
                            }
                        }
                    }
                    Column(
                        Modifier.width(210.dp).fillMaxHeight()
                            .verticalScroll(rememberScrollState()).padding(12.dp),
                    ) {
                        MemCardInfoPanel(currentCard, local, connected)
                        Spacer(Modifier.height(12.dp))
                        if (selectedSlot != null) MemCardDetailsPanel(selectedSlot!!)
                    }
                }
            } else {
                // ===== Portrait / Standard phone =====
                Column(
                    Modifier.fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 14.dp),
                ) {
                    Spacer(Modifier.height(8.dp))
                    if (result != null) {
                        MemCardResultBanner(result, onClearResult)
                        Spacer(Modifier.height(8.dp))
                    }
                    MemCardInfoBar(currentCard, cards, selectedCardIdx, local, connected) {
                        selectedCardIdx = it; selectedSlot = null
                    }
                    Spacer(Modifier.height(10.dp))
                    MemCardActionRow(
                        selectedSlot, connected,
                        onFetch, onPush, onCheats, onUndo, onDelete, onBack,
                    )
                    Spacer(Modifier.height(10.dp))
                    if (slots.isEmpty()) {
                        Text(
                            if (connected) "No saves detected. Insert a memory card in A-X-M."
                            else "No copies yet. Connect to A-X-M and saves come over automatically.",
                            color = Axm.TextDim, modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        MemCardSlotGrid(slots, selectedSlot, gridColumns) { slot ->
                            selectedSlot = if (selectedSlot == slot) null else slot
                        }
                    }
                    if (selectedSlot != null) {
                        Spacer(Modifier.height(10.dp))
                        MemCardDetailsPanel(selectedSlot!!)
                    }
                    Spacer(Modifier.height(14.dp))
                }
            }
        }

        // ---- Bottom bar ----
        MemCardHintBar()
    }
}

/* ---------- Header with title and accent line ---------- */

@Composable
private fun MemCardHeader(connected: Boolean, cardCount: Int, onBack: () -> Unit) {
    Column {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim,
                modifier = Modifier.size(24.dp).clickable(onClick = onBack),
            )
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    "Memory Card Saves",
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold, letterSpacing = 1.sp,
                    ),
                    color = Axm.GlowBlue,
                )
                Text(
                    if (connected) "Connected · $cardCount card(s)"
                    else "Offline · phone copies",
                    color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                )
            }
        }
        Box(
            Modifier.fillMaxWidth().height(2.dp)
                .background(
                    Brush.horizontalGradient(
                        listOf(Axm.GlowBlue, Axm.GlowBlue.copy(alpha = 0.05f)),
                    ),
                ),
        )
    }
}

/* ---------- Card info bar (portrait) ---------- */

@Composable
private fun MemCardInfoBar(
    card: SaveCard?,
    cards: List<SaveCard>,
    selectedIdx: Int,
    local: List<SaveStore.LocalSave>,
    connected: Boolean,
    onSelectCard: (Int) -> Unit,
) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .border(1.dp, Axm.SlotBorder, RoundedCornerShape(12.dp))
            .background(Axm.CardPanelBg).padding(14.dp),
    ) {
        if (card != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.SdCard, "Memory Card",
                    tint = Axm.GlowBlue, modifier = Modifier.size(32.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(card.name, color = Axm.Text, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${if (card.kind == "ps1") "PS1" else "PS2"} · ${card.saves.size} save(s) · 8 MB",
                        color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (cards.size > 1) {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        cards.forEachIndexed { i, _ ->
                            Box(
                                Modifier.size(28.dp).clip(RoundedCornerShape(6.dp))
                                    .border(
                                        1.dp,
                                        if (i == selectedIdx) Axm.GlowBlue else Axm.SlotBorder,
                                        RoundedCornerShape(6.dp),
                                    )
                                    .background(if (i == selectedIdx) Axm.CardPanelBg else Axm.SlotBackground)
                                    .clickable { onSelectCard(i) },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "${i + 1}",
                                    color = if (i == selectedIdx) Axm.GlowBlue else Axm.TextDim,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                    }
                }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Filled.SdCard, "Phone",
                    tint = Axm.TextDim, modifier = Modifier.size(32.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column {
                    Text("Phone Copies", color = Axm.Text, style = MaterialTheme.typography.titleMedium)
                    Text(
                        "${local.size} save(s) stored locally",
                        color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
    }
}

/* ---------- Card info panel (landscape right pane) ---------- */

@Composable
private fun MemCardInfoPanel(
    card: SaveCard?,
    local: List<SaveStore.LocalSave>,
    connected: Boolean,
) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .border(1.dp, Axm.SlotBorder, RoundedCornerShape(12.dp))
            .background(Axm.CardPanelBg).padding(14.dp),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(
                Icons.Filled.SdCard, "Memory Card",
                tint = Axm.GlowBlue, modifier = Modifier.size(48.dp),
            )
            Spacer(Modifier.height(8.dp))
            Text(
                card?.name ?: "Phone Copies", color = Axm.Text,
                style = MaterialTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
            )
            Spacer(Modifier.height(4.dp))
            if (card != null) {
                Text(
                    "${if (card.kind == "ps1") "PS1" else "PS2"} Memory Card",
                    color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                )
                Text(
                    "8 MB · ${card.saves.size} file(s)",
                    color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                )
            } else {
                Text(
                    "${local.size} save(s)",
                    color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

/* ---------- Card tabs (multi-card) ---------- */

@Composable
private fun MemCardTabs(cards: List<SaveCard>, selectedIdx: Int, onSelect: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        cards.forEachIndexed { i, card ->
            Box(
                Modifier.clip(RoundedCornerShape(8.dp))
                    .border(
                        1.dp,
                        if (i == selectedIdx) Axm.GlowBlue else Axm.SlotBorder,
                        RoundedCornerShape(8.dp),
                    )
                    .background(if (i == selectedIdx) Axm.CardPanelBg else Axm.SlotBackground)
                    .clickable { onSelect(i) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text(
                    card.name,
                    color = if (i == selectedIdx) Axm.GlowBlue else Axm.TextDim,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

/* ---------- Action button row (portrait) ---------- */

@Composable
private fun MemCardActionRow(
    selectedSlot: SlotInfo?,
    connected: Boolean,
    onFetch: (String, String) -> Unit,
    onPush: (String, String) -> Unit,
    onCheats: (String, String) -> Unit,
    onUndo: (String, String) -> Unit,
    onDelete: (String, String) -> Unit,
    onBack: () -> Unit,
) {
    val hasSave = selectedSlot?.saveName != null
    val hasLocal = selectedSlot?.hasLocal == true
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (connected) {
            MemCardActionBtn("Save", hasSave && hasLocal, Modifier.weight(1f)) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onPush(s.cardId, s.saveName)
            }
            MemCardActionBtn("Load", hasSave, Modifier.weight(1f)) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onFetch(s.cardId, s.saveName)
            }
        }
        MemCardActionBtn("Delete", hasSave && hasLocal, Modifier.weight(1f)) {
            val s = selectedSlot
            if (s != null && s.saveName != null) onDelete(s.cardId, s.saveName)
        }
        if (connected) {
            MemCardActionBtn("Cheats", hasSave, Modifier.weight(1f)) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onCheats(s.cardId, s.saveName)
            }
        }
        MemCardActionBtn("Exit", true, Modifier.weight(1f), onClick = onBack)
    }
}

@Composable
private fun MemCardActionBtn(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier.clip(RoundedCornerShape(10.dp))
            .border(
                1.dp,
                if (enabled) Axm.GlowBlue.copy(alpha = 0.7f)
                else Axm.SlotBorder.copy(alpha = 0.3f),
                RoundedCornerShape(10.dp),
            )
            .background(if (enabled) Axm.CardPanelBg else Axm.SlotBackground)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = if (enabled) Axm.Text else Axm.TextDim.copy(alpha = 0.3f),
            style = MaterialTheme.typography.labelLarge,
            textAlign = TextAlign.Center,
        )
    }
}

/* ---------- Action sidebar (landscape) ---------- */

@Composable
private fun MemCardActionSidebar(
    selectedSlot: SlotInfo?,
    connected: Boolean,
    onFetch: (String, String) -> Unit,
    onPush: (String, String) -> Unit,
    onCheats: (String, String) -> Unit,
    onUndo: (String, String) -> Unit,
    onDelete: (String, String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val hasSave = selectedSlot?.saveName != null
    val hasLocal = selectedSlot?.hasLocal == true
    Column(
        modifier.background(Axm.Panel).padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            "ACTIONS", color = Axm.GlowBlue,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        if (connected) {
            MemCardSideBtn("▶ Save", hasSave && hasLocal) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onPush(s.cardId, s.saveName)
            }
            MemCardSideBtn("Load", hasSave) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onFetch(s.cardId, s.saveName)
            }
        }
        MemCardSideBtn("Delete", hasSave && hasLocal) {
            val s = selectedSlot
            if (s != null && s.saveName != null) onDelete(s.cardId, s.saveName)
        }
        if (connected) {
            MemCardSideBtn("Cheats", hasSave) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onCheats(s.cardId, s.saveName)
            }
            MemCardSideBtn("Undo", hasSave) {
                val s = selectedSlot
                if (s != null && s.saveName != null) onUndo(s.cardId, s.saveName)
            }
        }
        Spacer(Modifier.weight(1f))
        MemCardSideBtn("Exit", true, onClick = onBack)
    }
}

@Composable
private fun MemCardSideBtn(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
            .border(
                1.dp,
                if (enabled) Axm.SlotBorder else Axm.SlotBorder.copy(alpha = 0.3f),
                RoundedCornerShape(8.dp),
            )
            .background(Axm.SlotBackground)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 10.dp, horizontal = 12.dp),
    ) {
        Text(
            label,
            color = if (enabled) Axm.Text else Axm.TextDim.copy(alpha = 0.3f),
            style = MaterialTheme.typography.labelLarge,
        )
    }
}

/* ---------- Save slot grid ---------- */

@Composable
private fun MemCardSlotGrid(
    slots: List<SlotInfo>,
    selected: SlotInfo?,
    columns: Int,
    onSelect: (SlotInfo) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        slots.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { slot ->
                    MemCardSlotCell(slot, slot == selected, Modifier.weight(1f)) {
                        onSelect(slot)
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun MemCardSlotCell(
    slot: SlotInfo,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val hasData = slot.saveName != null
    val borderColor = when {
        isSelected -> Axm.SlotSelected
        hasData -> Axm.GlowBlue.copy(alpha = 0.5f)
        else -> Axm.SlotBorder.copy(alpha = 0.3f)
    }
    Box(
        modifier.aspectRatio(1f).clip(RoundedCornerShape(10.dp))
            .border(
                if (isSelected) 2.dp else 1.dp,
                borderColor,
                RoundedCornerShape(10.dp),
            )
            .background(if (isSelected) Axm.CardPanelBg else Axm.SlotBackground)
            .clickable(enabled = hasData, onClick = onClick)
            .padding(6.dp),
    ) {
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                "${slot.number}",
                color = if (hasData) Axm.GlowBlue else Axm.TextDim.copy(alpha = 0.3f),
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.align(Alignment.Start),
            )
            Icon(
                Icons.AutoMirrored.Filled.InsertDriveFile, null,
                tint = if (hasData) Axm.TextDim else Axm.TextDim.copy(alpha = 0.15f),
                modifier = Modifier.size(22.dp),
            )
            Text(
                slot.title,
                color = if (hasData) Axm.Text else Axm.TextDim.copy(alpha = 0.3f),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp),
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/* ---------- Save data details panel ---------- */

@Composable
private fun MemCardDetailsPanel(slot: SlotInfo) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .border(1.dp, Axm.SlotBorder, RoundedCornerShape(12.dp))
            .background(Axm.CardPanelBg).padding(14.dp),
    ) {
        Column {
            Text(
                "Save Data Details", color = Axm.GlowBlue,
                style = MaterialTheme.typography.labelLarge,
            )
            Spacer(Modifier.height(8.dp))
            MemCardDetailRow("Title", slot.title)
            if (slot.localDate != null) MemCardDetailRow("Date", slot.localDate)
            MemCardDetailRow(
                "Size",
                if (slot.size > 0) "${slot.size / 1024} KB" else "\u2014",
            )
            MemCardDetailRow(
                "Type",
                if (slot.kind == "ps1") "PlayStation" else "PlayStation 2",
            )
            if (slot.hasLocal) {
                MemCardDetailRow(
                    "Status",
                    if (slot.localFresh) "Copy on phone \u2713" else "Phone copy is older",
                )
            }
        }
    }
}

@Composable
private fun MemCardDetailRow(label: String, value: String) {
    Row(Modifier.padding(vertical = 2.dp)) {
        Text(
            label, color = Axm.TextDim,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(70.dp),
        )
        Text(value, color = Axm.Text, style = MaterialTheme.typography.bodySmall)
    }
}

/* ---------- Result banner ---------- */

@Composable
private fun MemCardResultBanner(result: SaveResult, onClear: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
            .border(
                1.dp,
                if (result.ok) Axm.Good else Axm.Danger,
                RoundedCornerShape(12.dp),
            )
            .background(Axm.CardPanelBg).padding(14.dp),
    ) {
        Column {
            Text(
                if (result.ok) "Done" else "Not done",
                color = if (result.ok) Axm.Good else Axm.Danger,
                style = MaterialTheme.typography.labelLarge,
            )
            Text(result.message, color = Axm.Text, style = MaterialTheme.typography.bodyMedium)
            if (result.preview.isNotEmpty()) {
                Text(
                    result.preview.joinToString("\n"),
                    color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
                )
            }
            TextButton(onClick = onClear) { Text("OK", color = Axm.Accent) }
        }
    }
}

/* ---------- PS-style button hints ---------- */

@Composable
private fun MemCardHintBar() {
    Row(
        Modifier.fillMaxWidth().background(Axm.Panel)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            MemCardPsHint("\u2715", Color(0xFF5B8EF0), "Select")
            MemCardPsHint("\u25CB", Color(0xFFEF5350), "Back")
            MemCardPsHint("\u25B3", Color(0xFF66BB6A), "Options")
            MemCardPsHint("\u25A1", Color(0xFFEC407A), "Delete")
        }
    }
}

@Composable
private fun MemCardPsHint(symbol: String, color: Color, label: String) {
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
