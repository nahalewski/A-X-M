package com.axm.companion.net

import com.axm.companion.protocol.Capabilities
import com.axm.companion.protocol.CompanionMode
import com.axm.companion.protocol.CompanionSetting
import com.axm.companion.protocol.DiscoveredHost
import com.axm.companion.protocol.KeyboardPrompt
import com.axm.companion.protocol.MusicListing
import com.axm.companion.protocol.Frame
import com.axm.companion.protocol.GhostState
import com.axm.companion.protocol.MediaCommand
import com.axm.companion.protocol.MediaState
import com.axm.companion.protocol.Protocol
import com.axm.companion.protocol.XmbAction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Where the connection has got to. The UI branches on this and nothing else. */
sealed interface LinkState {
    data object Disconnected : LinkState
    data object Connecting : LinkState
    /** Host wants a code. It is shown on the A-X-M screen, not here. */
    data class NeedsPairing(val hostName: String, val attemptsLeft: Int? = null, val error: String? = null) : LinkState
    data class Connected(val hostName: String, val hostVersion: String) : LinkState
    data class Failed(val reason: String) : LinkState
}

/**
 * The link to A-X-M.
 *
 * One socket, opened when the user picks a host and kept alive afterwards. If it
 * drops while the app is still open it reconnects on its own with a backoff, because
 * a phone's Wi-Fi sleeping for a moment should not need the user to do anything.
 *
 * Pairing happens once. The host shows a four digit code, the user types it here,
 * and the host hands back a token that is stored and replayed on every later
 * connection - so the second time and after, connecting is silent.
 *
 * Nothing in here can send a path or a command. Every outbound frame is built from
 * the enums in Protocol, which is what keeps an open port on the host safe.
 */
class CompanionClient(
    private val capabilities: Capabilities,
    private val deviceName: String,
    private val deviceId: String,
    private val tokenStore: TokenStore,
) {
    interface TokenStore {
        fun read(hostKey: String): String?
        fun write(hostKey: String, token: String?)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val http = OkHttpClient.Builder()
        // The host pings every ten seconds; this is the backstop if those stop.
        .pingInterval(15, TimeUnit.SECONDS)
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var socket: WebSocket? = null
    private var host: DiscoveredHost? = null
    private var wantConnection = false
    private var attempt = 0

    private val _state = MutableStateFlow<LinkState>(LinkState.Disconnected)
    val state: StateFlow<LinkState> = _state.asStateFlow()

    private val _mode = MutableStateFlow(CompanionMode.IDLE)
    val mode: StateFlow<CompanionMode> = _mode.asStateFlow()

    private val _media = MutableStateFlow(MediaState())
    val media: StateFlow<MediaState> = _media.asStateFlow()

    private val _ghost = MutableStateFlow(GhostState.IDLE)
    val ghost: StateFlow<GhostState> = _ghost.asStateFlow()

    private val _ghostText = MutableStateFlow<String?>(null)
    val ghostText: StateFlow<String?> = _ghostText.asStateFlow()

    /** The menu's settings, as the host lists them; changed from here with sendSetting. */
    private val _settings = MutableStateFlow<List<CompanionSetting>>(emptyList())
    val settings: StateFlow<List<CompanionSetting>> = _settings.asStateFlow()

    /** A text prompt open on the A-X-M screen, or null. */
    private val _keyboard = MutableStateFlow<KeyboardPrompt?>(null)
    val keyboard: StateFlow<KeyboardPrompt?> = _keyboard.asStateFlow()

    /** The last music folder the host listed for us. */
    private val _musicListing = MutableStateFlow<MusicListing?>(null)
    val musicListing: StateFlow<MusicListing?> = _musicListing.asStateFlow()

    private fun hostKey(h: DiscoveredHost) = "${h.address}:${h.controlPort}"

    fun connect(target: DiscoveredHost) {
        host = target
        wantConnection = true
        attempt = 0
        open()
    }

    fun disconnect() {
        wantConnection = false
        send(Protocol.DEVICE_GOODBYE, JSONObject().put("reason", "user"))
        socket?.close(1000, "bye")
        socket = null
        _state.value = LinkState.Disconnected
    }

    /** Forgets this host's token, so the next connection pairs again. */
    fun forget() {
        host?.let { tokenStore.write(hostKey(it), null) }
    }

    private fun open() {
        val target = host ?: return
        _state.value = LinkState.Connecting

        val request = Request.Builder()
            .url("ws://${target.address}:${target.controlPort}")
            .build()

        socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                attempt = 0
                val hello = JSONObject()
                    .put("deviceId", deviceId)
                    .put("name", deviceName)
                    .put("platform", "android")
                    .put("capabilities", capabilities.toJson())
                tokenStore.read(hostKey(target))?.let { hello.put("token", it) }
                webSocket.send(Protocol.frame(Protocol.DEVICE_HELLO, hello))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                Protocol.parse(text)?.let { onFrame(it) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                _state.value = LinkState.Failed(t.message ?: "Could not reach A-X-M")
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                if (_state.value !is LinkState.Failed) _state.value = LinkState.Disconnected
                scheduleReconnect()
            }
        })
    }

    /**
     * Backs off to roughly ten seconds and stays there. Reconnecting is cheap and a
     * phone that has been in a pocket should find the host again without being told.
     */
    private fun scheduleReconnect() {
        if (!wantConnection) return
        val wait = minOf(10_000L, 500L * (1L shl minOf(attempt, 4)))
        attempt++
        scope.launch {
            delay(wait)
            if (wantConnection) open()
        }
    }

    private fun onFrame(frame: Frame) {
        if (frame.protocol != Protocol.VERSION) {
            _state.value = LinkState.Failed("A-X-M speaks a different companion version. Update one of them.")
            wantConnection = false
            socket?.close(1000, "version")
            return
        }
        val p = frame.payload
        when (frame.type) {
            Protocol.DEVICE_WELCOME -> {
                val name = p.optString("hostName", "A-X-M")
                if (p.optBoolean("paired", false)) {
                    _state.value = LinkState.Connected(name, p.optString("hostVersion", ""))
                } else {
                    _state.value = LinkState.NeedsPairing(name)
                }
            }
            Protocol.PAIR_RESULT -> {
                if (p.optBoolean("ok", false)) {
                    host?.let { tokenStore.write(hostKey(it), p.optString("token")) }
                    _state.value = LinkState.Connected(host?.hostName ?: "A-X-M", host?.hostVersion ?: "")
                } else {
                    val left = if (p.has("attemptsLeft")) p.optInt("attemptsLeft") else null
                    _state.value = LinkState.NeedsPairing(
                        host?.hostName ?: "A-X-M",
                        attemptsLeft = left,
                        error = p.optString("reason").ifEmpty { "That code is not right." },
                    )
                }
            }
            Protocol.LINK_PING -> send(Protocol.LINK_PONG, JSONObject().put("at", System.currentTimeMillis()))
            Protocol.LINK_ERROR -> {
                _state.value = LinkState.Failed(p.optString("message", "A-X-M refused the connection"))
                if (p.optBoolean("fatal", false)) wantConnection = false
            }
            Protocol.COMPANION_MODE -> _mode.value = CompanionMode.from(p.optString("mode", "idle"))
            Protocol.MEDIA_STATE -> _media.value = MediaState.from(p)
            Protocol.GHOST_STATE -> _ghost.value = GhostState.from(p.optString("state", "idle"))
            Protocol.GHOST_MESSAGE -> _ghostText.value = p.optString("text").ifEmpty { null }
            Protocol.SETTINGS_STATE -> _settings.value = CompanionSetting.list(p)
            Protocol.KEYBOARD_SHOW -> _keyboard.value = KeyboardPrompt.from(p)
            Protocol.KEYBOARD_HIDE -> _keyboard.value = null
            Protocol.MUSIC_LISTING -> _musicListing.value = MusicListing.from(p)
            else -> Unit   // A newer host naming a feature we lack is ignorable.
        }
    }

    // --------------------------------------------------------------- send --

    private fun send(type: String, payload: JSONObject) {
        socket?.send(Protocol.frame(type, payload))
    }

    fun submitPairingCode(code: String) =
        send(Protocol.PAIR_SUBMIT, JSONObject().put("code", code))

    fun sendXmb(action: XmbAction) =
        send(Protocol.XMB_INPUT, JSONObject().put("action", action.wire))

    fun sendMedia(command: MediaCommand, value: Double? = null) {
        val payload = JSONObject().put("command", command.wire)
        value?.let { payload.put("value", it) }
        send(Protocol.MEDIA_COMMAND, payload)
    }

    fun sendPointer(kind: String, dx: Float = 0f, dy: Float = 0f, button: String? = null) {
        val payload = JSONObject().put("kind", kind).put("dx", dx.toDouble()).put("dy", dy.toDouble())
        button?.let { payload.put("button", it) }
        send(Protocol.POINTER_INPUT, payload)
    }

    /** Identification only. The tag's contents never leave the phone. */
    fun sendToyScan(uid: String, technology: String?, head: String?, tail: String?) {
        val payload = JSONObject().put("uid", uid)
        technology?.let { payload.put("technology", it) }
        head?.let { payload.put("head", it) }
        tail?.let { payload.put("tail", it) }
        send(Protocol.TOYBOX_SCAN, payload)
    }

    fun sendSetting(id: String, value: String) =
        send(Protocol.SETTINGS_SET, JSONObject().put("id", id).put("value", value))

    /** What the phone has typed for the menu's prompt; done = enter / next. */
    fun sendKeyboard(text: String, done: Boolean) =
        send(Protocol.KEYBOARD_INPUT, JSONObject().put("text", text).put("done", done))

    /** A folder key from a listing, or null for the top of the library. */
    fun browseMusic(key: String?) {
        val payload = JSONObject()
        key?.let { payload.put("key", it) }
        send(Protocol.MUSIC_BROWSE, payload)
    }

    fun playMusic(key: String) = send(Protocol.MUSIC_PLAY, JSONObject().put("key", key))

    fun requestMode(mode: CompanionMode) =
        send(Protocol.COMPANION_MODE, JSONObject().put("mode", mode.wire))
}
