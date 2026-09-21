package com.axm.companion.saves

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/**
 * The phone's copies of the memory card saves, kept offline.
 *
 * One file per save under the app's private storage - the bytes exactly as the
 * host sent them (.psu for PS2, raw blocks for PS) - beside a small JSON of what
 * it is and when it came. They survive with no link to A-X-M: the list, the
 * details and the delete work offline, and a copy goes back onto the card the
 * next time the host is there.
 */
class SaveStore(context: Context) {
    private val root = File(context.filesDir, "saves").also { it.mkdirs() }

    data class LocalSave(
        val cardId: String,
        val save: String,
        val title: String,
        val kind: String,
        val fileName: String,
        val sha1: String,
        val at: String,
        val size: Long,
        val file: File,
    )

    private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9._-]"), "_")
    private fun dir(cardId: String) = File(root, safe(cardId)).also { it.mkdirs() }
    private fun dataFile(cardId: String, save: String) = File(dir(cardId), "${safe(save)}.bin")
    private fun metaFile(cardId: String, save: String) = File(dir(cardId), "${safe(save)}.json")

    fun put(cardId: String, save: String, title: String, kind: String, fileName: String, base64: String, sha1: String, at: String) {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        dataFile(cardId, save).writeBytes(bytes)
        metaFile(cardId, save).writeText(
            JSONObject().put("cardId", cardId).put("save", save).put("title", title).put("kind", kind)
                .put("fileName", fileName).put("sha1", sha1).put("at", at).put("size", bytes.size).toString()
        )
    }

    fun get(cardId: String, save: String): LocalSave? {
        val meta = metaFile(cardId, save)
        val data = dataFile(cardId, save)
        if (!meta.exists() || !data.exists()) return null
        return try {
            val o = JSONObject(meta.readText())
            LocalSave(
                cardId = o.optString("cardId"), save = o.optString("save"), title = o.optString("title"),
                kind = o.optString("kind"), fileName = o.optString("fileName"), sha1 = o.optString("sha1"),
                at = o.optString("at"), size = data.length(), file = data,
            )
        } catch (_: Exception) {
            null
        }
    }

    fun all(): List<LocalSave> =
        root.listFiles().orEmpty().filter { it.isDirectory }.flatMap { d ->
            d.listFiles().orEmpty().filter { it.name.endsWith(".json") }.mapNotNull { m ->
                try {
                    val o = JSONObject(m.readText())
                    get(o.optString("cardId"), o.optString("save"))
                } catch (_: Exception) {
                    null
                }
            }
        }.sortedBy { it.title.lowercase() }

    fun delete(cardId: String, save: String) {
        dataFile(cardId, save).delete()
        metaFile(cardId, save).delete()
    }

    /** The copy, base64, for sending back to the card. */
    fun base64Of(cardId: String, save: String): String? =
        dataFile(cardId, save).takeIf { it.exists() }?.let { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }

    fun sha1Of(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-1").digest(bytes).joinToString("") { "%02x".format(it) }
}
