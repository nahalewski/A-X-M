package com.axm.companion

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import android.view.WindowManager
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier
import com.axm.companion.ui.Axm
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.axm.companion.net.LinkState
import com.axm.companion.ui.AxmTheme
import com.axm.companion.ui.ControlsScreen
import com.axm.companion.ui.HomeScreen
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.axm.companion.protocol.KeyboardPrompt
import com.axm.companion.ui.KeyboardSheet
import com.axm.companion.ui.LibraryScreen
import com.axm.companion.ui.SettingsScreen
import com.axm.companion.ui.MediaScreen
import com.axm.companion.ui.PairingScreen
import com.axm.companion.ui.RemoteScreen
import com.axm.companion.ui.TouchpadScreen

/**
 * One activity, one view model, and a `when` over the link state.
 *
 * Pairing is not a screen the user navigates to - it is a state the connection is
 * in, so it takes over whatever they were looking at and hands control back when
 * it resolves. That way there is no way to be half-paired and looking at a remote
 * that silently does nothing.
 */
class MainActivity : ComponentActivity() {

    private val model: CompanionViewModel by viewModels()
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // A remote that dims and drops its link is no remote: the screen stays on
        // while the app is in front, and the Wi-Fi radio is held at full power so
        // the phone's power saving does not cut the socket every few seconds.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent {
            AxmTheme {
                // Under the status bar and the navigation bar, never behind them.
                Box(Modifier.fillMaxSize().background(Axm.Background).systemBarsPadding()) { Root(model) }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "A-X-M Companion").also { it.acquire() }
        // Coming back to the app is the moment to look again: the phone may have
        // changed network, or A-X-M may have started since.
        model.refresh()
    }

    override fun onPause() {
        wifiLock?.let { if (it.isHeld) it.release() }
        wifiLock = null
        super.onPause()
    }
}

@Composable
private fun Root(model: CompanionViewModel) {
    val link by model.link.collectAsStateWithLifecycle()
    val hosts by model.hosts.collectAsStateWithLifecycle()
    val scanning by model.scanning.collectAsStateWithLifecycle()
    val screen by model.screen.collectAsStateWithLifecycle()
    val media by model.client.media.collectAsStateWithLifecycle()
    val settings by model.client.settings.collectAsStateWithLifecycle()
    val keyboard by model.client.keyboard.collectAsStateWithLifecycle()
    val listing by model.client.musicListing.collectAsStateWithLifecycle()
    val visualizer = settings.firstOrNull { it.id == "visualizerStyle" }
    // A prompt on the A-X-M screen takes this screen too, so typing can start at once.
    var keyboardDismissed by remember { mutableStateOf<KeyboardPrompt?>(null) }

    // Pairing outranks everything: there is nothing useful to show behind it.
    if (link is LinkState.NeedsPairing) {
        PairingScreen(
            state = link as LinkState.NeedsPairing,
            onSubmit = model::submitCode,
            onCancel = model::disconnect,
        )
        return
    }

    // Typed as a composable lambda: a plain one cannot call composables, and this
    // is shown from three places, so it is worth naming once.
    val home: @Composable () -> Unit = {
        HomeScreen(
            link = link,
            hosts = hosts,
            scanning = scanning,
            onRefresh = model::refresh,
            onConnect = model::connect,
            onDisconnect = model::disconnect,
            onOpen = model::show,
        )
    }

    // Losing the link drops back to home rather than leaving a remote on screen
    // whose buttons would quietly go nowhere.
    if (link !is LinkState.Connected) {
        home()
        return
    }

    val prompt = keyboard
    if (prompt != null && keyboardDismissed != prompt) {
        KeyboardSheet(prompt, onInput = model::keyboard, onDismiss = { keyboardDismissed = prompt })
        return
    }

    when (screen) {
        Screen.HOME -> home()
        Screen.REMOTE -> ControlsScreen(
            media = media,
            onAction = model::xmb,
            onCommand = { command, value -> model.media(command, value) },
            onBack = { model.show(Screen.HOME) },
            onRoute = model::routeAudio,
            visualizer = visualizer,
            onVisualizer = { model.setSetting("visualizerStyle", it) },
            onLibrary = { model.show(Screen.LIBRARY) },
        )
        Screen.MEDIA -> MediaScreen(
            media = media,
            onCommand = { command, value -> model.media(command, value) },
            onBack = { model.show(Screen.HOME) },
            onRoute = model::routeAudio,
            visualizer = visualizer,
            onVisualizer = { model.setSetting("visualizerStyle", it) },
            onLibrary = { model.show(Screen.LIBRARY) },
        )
        Screen.SETTINGS -> SettingsScreen(
            items = settings,
            onSet = model::setSetting,
            onBack = { model.show(Screen.HOME) },
        )
        Screen.LIBRARY -> LibraryScreen(
            listing = listing,
            media = media,
            onBrowse = model::browse,
            onPlay = model::playTrack,
            onBack = { model.show(Screen.HOME) },
        )
        Screen.TOUCHPAD -> TouchpadScreen(
            onPointer = { kind, dx, dy, button -> model.pointer(kind, dx, dy, button) },
            onBack = { model.show(Screen.HOME) },
        )
        // Built next, alongside the NFC reader and the Ghost avatar.
        Screen.TOYBOX, Screen.GHOST -> home()
    }
}
