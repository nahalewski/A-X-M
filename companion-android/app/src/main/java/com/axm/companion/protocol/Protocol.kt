package com.axm.companion.protocol

import org.json.JSONObject

/**
 * The wire contract with A-X-M. This is the Kotlin side of
 * src/main/companion/protocol.ts in the A-X-M repository; the two are kept in step
 * by diffing those two files, so any change here needs the same change there.
 *
 * The rules that matter:
 *
 * - Every frame is one JSON object carrying `protocol`, `type` and `payload`. A
 *   version we do not know is reported and the socket closed, rather than guessing
 *   at a payload whose shape may have moved.
 * - Nothing the phone can send names a file, a path or a command. Every outbound
 *   message picks from a fixed set; the host decides what those mean. That is what
 *   makes an open port on the host acceptable.
 */
object Protocol {
    const val VERSION = 1
    const val DISCOVERY_PORT = 47820
    const val CONTROL_PORT = 47821
    const val DISCOVERY_MAGIC = "AXM-COMPANION-DISCOVER"

    // Types the host accepts before pairing. Anything else is refused and the
    // socket dropped, so there is no point sending it.
    const val DEVICE_HELLO = "device.hello"
    const val DEVICE_WELCOME = "device.welcome"
    const val DEVICE_GOODBYE = "device.goodbye"
    const val PAIR_SUBMIT = "pair.submit"
    const val PAIR_RESULT = "pair.result"
    const val LINK_PING = "link.ping"
    const val LINK_PONG = "link.pong"
    const val LINK_ERROR = "link.error"

    const val COMPANION_MODE = "companion.mode"
    const val XMB_INPUT = "xmb.input"
    const val MEDIA_COMMAND = "media.command"
    const val MEDIA_STATE = "media.state"
    const val POINTER_INPUT = "pointer.input"
    const val TOYBOX_SCAN = "toybox.scan"
    const val TOYBOX_METADATA = "toybox.metadata"
    const val GHOST_STATE = "ghost.state"
    const val GHOST_MESSAGE = "ghost.message"

    fun frame(type: String, payload: JSONObject): String =
        JSONObject()
            .put("protocol", VERSION)
            .put("type", type)
            .put("payload", payload)
            .toString()

    /** Never throws: this parses bytes off the network, where anything can arrive. */
    fun parse(raw: String): Frame? = try {
        val o = JSONObject(raw)
        val type = o.optString("type", "")
        val payload = o.optJSONObject("payload")
        if (type.isEmpty() || payload == null) null
        else Frame(o.optInt("protocol", -1), type, payload)
    } catch (_: Exception) {
        null
    }
}

data class Frame(val protocol: Int, val type: String, val payload: JSONObject)

/** What this phone can do. The host switches features on from this, never assumes. */
data class Capabilities(
    val touch: Boolean = true,
    val nfc: Boolean = false,
    val foldable: Boolean = false,
    val gyro: Boolean = false,
    val haptics: Boolean = true,
    val videoDecode: Boolean = true,
    val camera: Boolean = false,
    val microphone: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("touch", touch)
        .put("nfc", nfc)
        .put("foldable", foldable)
        .put("gyro", gyro)
        .put("haptics", haptics)
        .put("videoDecode", videoDecode)
        .put("camera", camera)
        .put("microphone", microphone)
}

/** An A-X-M host that answered a discovery probe. */
data class DiscoveredHost(
    val address: String,
    val controlPort: Int,
    val hostName: String,
    val hostVersion: String,
    val protocol: Int,
)

/** Which screen the phone is showing. The host can ask for a change. */
enum class CompanionMode(val wire: String) {
    IDLE("idle"),
    MEDIA_REMOTE("media_remote"),
    TOUCHPAD("touchpad"),
    XMB_CONTROLLER("xmb_controller"),
    DS_SECOND_SCREEN("ds_second_screen"),
    THREE_DS_SECOND_SCREEN("3ds_second_screen"),
    TOY_BOX("toy_box"),
    GHOST("ghost");

    companion object {
        fun from(wire: String): CompanionMode =
            entries.firstOrNull { it.wire == wire } ?: IDLE
    }
}

/** Menu actions, matching exactly what the A-X-M menu already understands. */
enum class XmbAction(val wire: String) {
    UP("up"), DOWN("down"), LEFT("left"), RIGHT("right"),
    CONFIRM("confirm"), BACK("back"), CONTEXT("context"), GUIDE("guide")
}

enum class MediaCommand(val wire: String) {
    PLAY("play"), PAUSE("pause"), TOGGLE("toggle"), NEXT("next"), PREVIOUS("previous"),
    STOP("stop"), VOLUME("volume"), MUTE("mute"), SHUFFLE("shuffle"),
    REPEAT("repeat"), FAVORITE("favorite"), SEEK("seek"), POSITION("position"), ROUTE("route")
}

/** What A-X-M says is playing. The host is the authority; this only mirrors it. */
data class MediaState(
    val playing: Boolean = false,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val artworkUrl: String? = null,
    val positionSeconds: Double = 0.0,
    val durationSeconds: Double = 0.0,
    val volume: Double = 1.0,
    val muted: Boolean = false,
    val streamUrl: String? = null,
    val output: String = "host",
) {
    companion object {
        fun from(p: JSONObject) = MediaState(
            playing = p.optBoolean("playing", false),
            title = p.optString("title").ifEmpty { null },
            artist = p.optString("artist").ifEmpty { null },
            album = p.optString("album").ifEmpty { null },
            artworkUrl = p.optString("artworkUrl").ifEmpty { null },
            positionSeconds = p.optDouble("positionSeconds", 0.0),
            durationSeconds = p.optDouble("durationSeconds", 0.0),
            volume = p.optDouble("volume", 1.0),
            muted = p.optBoolean("muted", false),
            streamUrl = p.optString("streamUrl").ifEmpty { null },
            output = p.optString("output").ifEmpty { "host" },
        )
    }
}

enum class GhostState(val wire: String) {
    IDLE("idle"), LISTENING("listening"), THINKING("thinking"),
    SPEAKING("speaking"), SCANNING("scanning"), ERROR("error");

    companion object {
        fun from(wire: String): GhostState = entries.firstOrNull { it.wire == wire } ?: IDLE
    }
}
