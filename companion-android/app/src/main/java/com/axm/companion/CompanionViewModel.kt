package com.axm.companion

import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.axm.companion.net.CompanionClient
import com.axm.companion.net.Discovery
import com.axm.companion.net.LinkState
import com.axm.companion.protocol.Capabilities
import com.axm.companion.protocol.DiscoveredHost
import com.axm.companion.protocol.MediaCommand
import com.axm.companion.protocol.XmbAction
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/** Which screen the user is on. The host can also drive this, later. */
enum class Screen { HOME, REMOTE, MEDIA, TOUCHPAD, TOYBOX, GHOST, SETTINGS, LIBRARY, SAVES, CHEATS, DEVICE }

/**
 * Holds the link and everything the screens read.
 *
 * The device id is generated once on first run and kept, because it is what the
 * host's trust list is keyed on - regenerating it would silently orphan a pairing
 * and make the phone look like a new device every launch.
 */
class CompanionViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("axm-companion", Context.MODE_PRIVATE)

    private val deviceId: String = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also {
        prefs.edit().putString("deviceId", it).apply()
    }

    private val capabilities = Capabilities(
        touch = true,
        nfc = app.packageManager.hasSystemFeature(PackageManager.FEATURE_NFC),
        // Reported honestly: the host picks layouts from this, and claiming a
        // posture API we cannot serve would give us a layout we cannot fill.
        foldable = app.packageManager.hasSystemFeature("android.hardware.sensor.hinge_angle"),
        gyro = app.packageManager.hasSystemFeature(PackageManager.FEATURE_SENSOR_GYROSCOPE),
        haptics = true,
        videoDecode = true,
        camera = app.packageManager.hasSystemFeature(PackageManager.FEATURE_CAMERA_ANY),
        microphone = app.packageManager.hasSystemFeature(PackageManager.FEATURE_MICROPHONE),
    )

    val client = CompanionClient(
        capabilities = capabilities,
        deviceName = "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
        deviceId = deviceId,
        tokenStore = object : CompanionClient.TokenStore {
            override fun read(hostKey: String): String? = prefs.getString("token:$hostKey", null)
            override fun write(hostKey: String, token: String?) {
                prefs.edit().apply {
                    if (token == null) remove("token:$hostKey") else putString("token:$hostKey", token)
                }.apply()
            }
        },
    )

    val link: StateFlow<LinkState> = client.state

    private val _hosts = MutableStateFlow<List<DiscoveredHost>>(emptyList())
    val hosts: StateFlow<List<DiscoveredHost>> = _hosts.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val _screen = MutableStateFlow(Screen.HOME)
    val screen: StateFlow<Screen> = _screen.asStateFlow()

    init {
        // Look for a host straight away: the common case is one machine on the
        // network that this phone has already paired with.
        refresh()
    }

    fun show(screen: Screen) {
        _screen.value = screen
    }

    fun refresh() {
        if (_scanning.value) return
        _scanning.value = true
        viewModelScope.launch {
            val found = Discovery.probe()
            _hosts.value = found
            _scanning.value = false
            // One host and a token for it already: connect without being asked.
            if (found.size == 1 && link.value is LinkState.Disconnected) connect(found.first())
        }
    }

    fun connect(host: DiscoveredHost) = client.connect(host)
    fun disconnect() = client.disconnect()
    fun forget() = client.forget()
    fun submitCode(code: String) = client.submitPairingCode(code)

    fun xmb(action: XmbAction) = client.sendXmb(action)
    fun media(command: MediaCommand, value: Double? = null) = client.sendMedia(command, value)

    /** The phone's own player, live while the host says the output is the phone. */
    private val phonePlayer = com.axm.companion.net.PhonePlayer(app)
    private var followingOutput = false

    /** Switches the music to this phone (Bluetooth follows the phone), or back to the PC. */
    fun routeAudio(toPhone: Boolean) {
        if (!toPhone) {
            // Hand back from where the phone got to.
            client.sendMedia(MediaCommand.POSITION, phonePlayer.position())
            phonePlayer.release()
        }
        client.sendMedia(MediaCommand.ROUTE, if (toPhone) 1.0 else 0.0)
    }

    init {
        viewModelScope.launch {
            client.media.collect { m ->
                val onPhone = m.output == "phone" && m.streamUrl != null
                if (onPhone) {
                    followingOutput = true
                    if (m.playing) phonePlayer.play(m.streamUrl!!, m.positionSeconds) else phonePlayer.pause()
                } else if (followingOutput) {
                    followingOutput = false
                    phonePlayer.release()
                }
            }
        }
    }

    override fun onCleared() {
        phonePlayer.destroy()
        phone.destroy()
        super.onCleared()
    }
    fun pointer(kind: String, dx: Float = 0f, dy: Float = 0f, button: String? = null) =
        client.sendPointer(kind, dx, dy, button)

    // ---- memory card saves: the offline copies, and Apollo through the host ----

    val store = com.axm.companion.saves.SaveStore(app)
    private val _localSaves = MutableStateFlow(store.all())
    val localSaves: StateFlow<List<com.axm.companion.saves.SaveStore.LocalSave>> = _localSaves.asStateFlow()

    /** The save whose cheats page is open. */
    private val _cheatsFor = MutableStateFlow<Pair<String, String>?>(null)
    val cheatsFor: StateFlow<Pair<String, String>?> = _cheatsFor.asStateFlow()

    init {
        viewModelScope.launch {
            // Every copy the host sends lands in the store; the list on screen follows.
            client.saveFiles.collect { f ->
                store.put(f.cardId, f.save, f.title, f.kind, f.fileName, f.base64, f.sha1, f.at)
                _localSaves.value = store.all()
            }
        }
        viewModelScope.launch {
            // Auto-sync: whatever the host lists that the phone lacks (or holds an older copy of) is asked for.
            client.saves.collect { listing ->
                if (listing == null || !listing.autoSync) return@collect
                for (card in listing.cards) for (s in card.saves) {
                    val local = store.get(card.id, s.name)
                    if (s.sha1.isNotEmpty() && local?.sha1 != s.sha1) client.requestSave(card.id, s.name)
                }
            }
        }
    }

    fun fetchSave(cardId: String, save: String) = client.requestSave(cardId, save)
    fun pushSave(cardId: String, save: String) { store.base64Of(cardId, save)?.let { client.pushSave(cardId, save, it) } }
    fun deleteLocal(cardId: String, save: String) { store.delete(cardId, save); _localSaves.value = store.all() }
    fun openCheats(cardId: String, save: String) { _cheatsFor.value = cardId to save; client.requestCheats(cardId, save); show(Screen.CHEATS) }
    fun applyCheats(selections: List<Pair<String, Map<String, String>>>, preview: Boolean) { _cheatsFor.value?.let { (c, s) -> client.applyCheats(c, s, selections, preview) } }
    fun undoLastEdit(cardId: String, save: String) = client.restoreSave(cardId, save)
    fun clearResult() = client.clearSaveResult()

    /** A menu setting changed from the phone. The host applies it and lists again. */
    fun setSetting(id: String, value: String) = client.sendSetting(id, value)

    fun keyboard(text: String, done: Boolean) = client.sendKeyboard(text, done)

    fun browse(key: String?) = client.browseMusic(key)
    fun playTrack(key: String) = client.playMusic(key)

    // ---- Device Sharing (experimental): this phone's calls, texts and contacts for A-X-M ----

    val phone = com.axm.companion.device.PhoneBridge(app) { type, payload -> client.sendPhone(type, payload) }

    init {
        client.phoneListener = { type, payload -> phone.onHostFrame(type, payload) }
        viewModelScope.launch {
            // Told on every (re)connection what is shared; a dropped link stops the pushes.
            var wasConnected = false
            client.state.collect { s ->
                val now = s is LinkState.Connected
                if (now && !wasConnected) phone.onConnected() else if (!now && wasConnected) phone.onDisconnected()
                wasConnected = now
            }
        }
    }

    fun setSharing(feature: com.axm.companion.device.PhoneBridge.Feature, on: Boolean) = phone.setWanted(feature, on)

    /** Permissions can change in Android's settings while the app is away. */
    fun recheckSharing() = phone.refresh()
}
