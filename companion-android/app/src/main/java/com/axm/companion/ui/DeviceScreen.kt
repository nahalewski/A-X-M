package com.axm.companion.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Message
import androidx.compose.material.icons.filled.Contacts
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.axm.companion.device.PhoneBridge

/**
 * Device Sharing (experimental): which of this phone's Phone, Messages and
 * Contacts A-X-M's Device column may use. Each switch asks Android for its
 * permissions the first time it is turned on; turning one off stops sharing at
 * once, whatever Android still allows.
 *
 * On a phone the three sit in a column; on a tablet (or an unfolded foldable)
 * they sit side by side. A Wi-Fi tablet has no mobile service, so it can share
 * its contacts and nothing else - its Phone and Messages cards say so.
 */
@Composable
fun DeviceScreen(
    status: PhoneBridge.Status,
    connected: Boolean,
    permissionsFor: (PhoneBridge.Feature) -> Array<String>,
    onSet: (PhoneBridge.Feature, Boolean) -> Unit,
    onPermissionsChanged: () -> Unit,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    // The feature whose permissions are being asked for, switched on once they're granted.
    var asking by remember { mutableStateOf<PhoneBridge.Feature?>(null) }
    var denied by remember { mutableStateOf<PhoneBridge.Feature?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val f = asking
        asking = null
        if (f != null) {
            if (result.values.all { it }) {
                denied = null
                onSet(f, true)
            } else denied = f
        }
        onPermissionsChanged()
    }

    Column(Modifier.fillMaxSize().background(Axm.Background).padding(22.dp).verticalScroll(rememberScrollState())) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = Axm.TextDim, modifier = Modifier.clickable(onClick = onBack))
            Spacer(Modifier.width(14.dp))
            Column {
                Text("Device Sharing", style = MaterialTheme.typography.titleLarge, color = Axm.Text)
                Text("Experimental · for A-X-M's Device column", style = MaterialTheme.typography.bodyMedium, color = Axm.Accent)
            }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "Make calls, text and look up contacts from the A-X-M menu. Calls and texts still go through this " +
                (if (status.tablet) "tablet" else "phone") +
                " - its number, its SIM, its speaker or headset. Turn on Experimental Features in A-X-M's Settings too.",
            color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(18.dp))

        val cards = listOf(
            Triple(PhoneBridge.Feature.CALLS, Icons.Filled.Phone, "Phone"),
            Triple(PhoneBridge.Feature.MESSAGES, Icons.AutoMirrored.Filled.Message, "Messages"),
            Triple(PhoneBridge.Feature.CONTACTS, Icons.Filled.Contacts, "Contacts"),
        )
        val card: @Composable (PhoneBridge.Feature, ImageVector, String, Modifier) -> Unit = { f, icon, title, modifier ->
            val needsSim = f != PhoneBridge.Feature.CONTACTS && !status.telephony
            val wanted = status.wanted[f] == true
            val shared = status.shared[f] == true
            val detail = when {
                needsSim -> "No mobile service on this device"
                shared -> when (f) {
                    PhoneBridge.Feature.CALLS -> "Shared · place, answer and end calls, and your recent calls"
                    PhoneBridge.Feature.MESSAGES -> "Shared · your conversations, and texts sent from here"
                    PhoneBridge.Feature.CONTACTS -> "Shared · names, numbers and pictures"
                }
                wanted -> "Waiting for Android's permission"
                else -> "Not shared"
            }
            FeatureCard(
                icon = icon, title = title, detail = detail, checked = wanted && !needsSim, enabled = !needsSim,
                warn = denied == f, modifier = modifier,
                onToggle = { on ->
                    if (!on) onSet(f, false)
                    else if (status.shared[f] == true || permissionsFor(f).all { context.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }) onSet(f, true)
                    else {
                        asking = f
                        launcher.launch(permissionsFor(f))
                    }
                },
            )
        }

        BoxWithConstraints(Modifier.fillMaxWidth()) {
            if (maxWidth >= 600.dp) {
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.fillMaxWidth()) {
                    cards.forEach { (f, icon, title) -> card(f, icon, title, Modifier.weight(1f)) }
                }
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    cards.forEach { (f, icon, title) -> card(f, icon, title, Modifier.fillMaxWidth()) }
                }
            }
        }

        if (denied != null) {
            Spacer(Modifier.height(14.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Axm.PanelRaised).padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Info, null, tint = Axm.Danger, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(10.dp))
                Text("Android didn't allow it. You can allow it in the app's settings.", color = Axm.Text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)))
                }) { Text("Open", color = Axm.Accent) }
            }
        }

        Spacer(Modifier.height(20.dp))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Axm.Panel).padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Info, null, tint = Axm.TextDim, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(10.dp))
            Text(
                if (connected) "A-X-M sees what's shared straight away. Nothing is kept on the PC: it asks when one of its apps opens."
                else "Not connected to A-X-M. Sharing starts when you connect.",
                color = Axm.TextDim, style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
private fun FeatureCard(
    icon: ImageVector,
    title: String,
    detail: String,
    checked: Boolean,
    enabled: Boolean,
    warn: Boolean,
    modifier: Modifier,
    onToggle: (Boolean) -> Unit,
) {
    Column(
        modifier.clip(RoundedCornerShape(16.dp))
            .border(1.dp, if (warn) Axm.Danger else if (checked) Axm.IconTileGlow else Axm.SlotBorder, RoundedCornerShape(16.dp))
            .background(if (enabled) Axm.SlotBackground else Axm.DisabledTile)
            .clickable(enabled = enabled) { onToggle(!checked) }
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = if (enabled) Axm.IconTileGlow else Axm.TextDim, modifier = Modifier.size(28.dp))
            Spacer(Modifier.width(12.dp))
            Text(title, color = if (enabled) Axm.Text else Axm.TextDim, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Switch(
                checked = checked,
                enabled = enabled,
                onCheckedChange = onToggle,
                colors = SwitchDefaults.colors(checkedThumbColor = Axm.Background, checkedTrackColor = Axm.Accent, uncheckedTrackColor = Axm.PanelRaised),
            )
        }
        Spacer(Modifier.height(6.dp))
        Text(detail, color = Axm.TextDim, style = MaterialTheme.typography.bodyMedium)
    }
}
