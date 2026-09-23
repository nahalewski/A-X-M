package com.axm.companion.device

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import android.telecom.TelecomManager
import android.telephony.SmsManager
import android.telephony.TelephonyManager
import android.util.Base64
import com.axm.companion.protocol.Protocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * Experimental: Device Sharing. This phone's calls, texts and contacts, for the
 * Device column in A-X-M, which draws its own Phone, Messages and Contacts apps.
 *
 * The phone is the authority here. The host can only ask, and every ask is checked
 * against two things before anything happens: the switch the user set on this
 * screen, and the permission Android granted. A host that asks for texts when
 * Messages is off gets nothing. Calls go out through the phone's own telecom
 * service and texts through its own SMS manager, so the SIM, the number and the
 * call audio all stay on the phone.
 *
 * Nothing is stored for the host and nothing is pushed until it has asked for that
 * list on this connection; after that, changes (a new text, a call ending) are sent
 * as they happen.
 */
class PhoneBridge(
    private val context: Context,
    private val send: (type: String, payload: JSONObject) -> Unit,
) {
    enum class Feature(val key: String) { CALLS("calls"), MESSAGES("messages"), CONTACTS("contacts") }

    data class Status(
        /** The user's switch for each, whether or not Android has granted it yet. */
        val wanted: Map<Feature, Boolean>,
        /** Switched on and granted: what the host is told it can use. */
        val shared: Map<Feature, Boolean>,
        val telephony: Boolean,
        val tablet: Boolean,
    )

    private val prefs = context.getSharedPreferences("axm-device-sharing", Context.MODE_PRIVATE)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val main = Handler(Looper.getMainLooper())

    /** Lists the host has asked for on this connection, so changes are pushed only to a listener. */
    private val subscribed = mutableSetOf<String>()
    private var connected = false

    private val _status = MutableStateFlow(computeStatus())
    val status: StateFlow<Status> = _status.asStateFlow()

    // ------------------------------------------------------------ settings --

    fun isWanted(f: Feature): Boolean = prefs.getBoolean(f.key, false)

    fun setWanted(f: Feature, on: Boolean) {
        prefs.edit().putBoolean(f.key, on).apply()
        refresh()
    }

    /** What Android must grant for each feature. */
    fun permissionsFor(f: Feature): Array<String> = when (f) {
        Feature.CALLS -> buildList {
            add(Manifest.permission.CALL_PHONE)
            add(Manifest.permission.READ_CALL_LOG)
            add(Manifest.permission.READ_PHONE_STATE)
            if (Build.VERSION.SDK_INT >= 26) add(Manifest.permission.ANSWER_PHONE_CALLS)
        }.toTypedArray()
        Feature.MESSAGES -> arrayOf(Manifest.permission.READ_SMS, Manifest.permission.SEND_SMS, Manifest.permission.RECEIVE_SMS)
        Feature.CONTACTS -> arrayOf(Manifest.permission.READ_CONTACTS)
    }

    fun granted(f: Feature): Boolean = permissionsFor(f).all { has(it) }

    private fun has(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun computeStatus(): Status {
        val tel = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
        val wanted = Feature.values().associateWith { prefs.getBoolean(it.key, false) }
        val shared = Feature.values().associateWith { f ->
            wanted[f] == true && permissionsFor(f).all { has(it) } && (f == Feature.CONTACTS || tel)
        }
        return Status(wanted, shared, tel, context.resources.configuration.smallestScreenWidthDp >= 600)
    }

    /** Re-reads switches and permissions (after a grant, or coming back to the app) and tells the host. */
    fun refresh() {
        _status.value = computeStatus()
        registerWatchers()
        if (connected) sendState()
    }

    private fun shared(f: Feature) = _status.value.shared[f] == true

    // ---------------------------------------------------------- connection --

    fun onConnected() {
        connected = true
        subscribed.clear()
        refresh()
    }

    fun onDisconnected() {
        connected = false
        subscribed.clear()
    }

    private fun sendState() {
        val s = _status.value
        send(
            Protocol.PHONE_STATE,
            JSONObject()
                .put("calls", s.shared[Feature.CALLS] == true)
                .put("messages", s.shared[Feature.MESSAGES] == true)
                .put("contacts", s.shared[Feature.CONTACTS] == true)
                .put("telephony", s.telephony)
                .put("formFactor", if (s.tablet) "tablet" else "phone"),
        )
    }

    // ------------------------------------------------------------- inbound --

    /** A phone.* frame from the host. Anything not shared is ignored, not answered. */
    fun onHostFrame(type: String, p: JSONObject) {
        when (type) {
            Protocol.PHONE_REQUEST -> {
                val what = p.optString("what")
                subscribed += what
                scope.launch {
                    when (what) {
                        "contacts" -> if (shared(Feature.CONTACTS)) send(Protocol.PHONE_CONTACTS, JSONObject().put("contacts", contacts()))
                        "threads" -> if (shared(Feature.MESSAGES)) send(Protocol.PHONE_THREADS, JSONObject().put("threads", threads()))
                        "calls" -> if (shared(Feature.CALLS)) send(Protocol.PHONE_CALLS, JSONObject().put("calls", calls()))
                        "messages" -> if (shared(Feature.MESSAGES)) {
                            val threadId = p.optString("threadId")
                            if (threadId.isNotEmpty()) messages(threadId)?.let { send(Protocol.PHONE_MESSAGES, it) }
                        }
                    }
                }
            }
            Protocol.PHONE_DIAL -> if (shared(Feature.CALLS)) dial(p.optString("number"))
            Protocol.PHONE_ANSWER -> if (shared(Feature.CALLS)) answer()
            Protocol.PHONE_HANGUP -> if (shared(Feature.CALLS)) hangUp()
            Protocol.PHONE_SEND_SMS -> {
                val ref = p.optString("ref")
                if (!shared(Feature.MESSAGES)) {
                    smsResult(ref, false, "Messages isn't shared on the phone")
                    return
                }
                sendSms(p.optString("to"), p.optString("body"), ref)
            }
        }
    }

    // ------------------------------------------------------------ contacts --

    private fun contacts(): JSONArray {
        data class C(val id: String, val name: String, val starred: Boolean, val photo: String?, val numbers: MutableList<Pair<String, String>>)
        val byId = LinkedHashMap<String, C>()
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
            ContactsContract.CommonDataKinds.Phone.TYPE,
            ContactsContract.CommonDataKinds.Phone.LABEL,
            ContactsContract.CommonDataKinds.Phone.STARRED,
            ContactsContract.CommonDataKinds.Phone.PHOTO_THUMBNAIL_URI,
        )
        runCatching {
            context.contentResolver.query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI, projection, null, null, null)?.use { c ->
                while (c.moveToNext() && byId.size < MAX_CONTACTS) {
                    val id = c.getString(0) ?: continue
                    val number = c.getString(2)?.trim().orEmpty()
                    if (number.isEmpty()) continue
                    val label = ContactsContract.CommonDataKinds.Phone.getTypeLabel(context.resources, c.getInt(3), c.getString(4)).toString()
                    val entry = byId.getOrPut(id) { C(id, c.getString(1).orEmpty(), c.getInt(5) == 1, c.getString(6), mutableListOf()) }
                    // The same number saved twice (with and without +1) is one number.
                    val digits = number.filter { it.isDigit() }.takeLast(9)
                    if (entry.numbers.none { it.second.filter { d -> d.isDigit() }.takeLast(9) == digits }) entry.numbers += label to number
                }
            }
        }
        val out = JSONArray()
        var photos = 0
        for (c in byId.values) {
            val o = JSONObject().put("id", c.id).put("name", c.name).put("starred", c.starred)
            val numbers = JSONArray()
            c.numbers.take(12).forEach { (label, number) -> numbers.put(JSONObject().put("number", number).put("label", label)) }
            o.put("numbers", numbers)
            if (c.photo != null && photos < MAX_PHOTOS) thumbnail(Uri.parse(c.photo))?.let { o.put("photo", it); photos++ }
            out.put(o)
        }
        return out
    }

    /** A contact's picture as a small JPEG data: URL - a few KB, not the full photo. */
    private fun thumbnail(uri: Uri): String? = runCatching {
        val bitmap = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) } ?: return null
        val scaled = Bitmap.createScaledBitmap(bitmap, PHOTO_PX, PHOTO_PX, true)
        val bytes = ByteArrayOutputStream().also { scaled.compress(Bitmap.CompressFormat.JPEG, 70, it) }.toByteArray()
        "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
    }.getOrNull()

    private fun nameFor(number: String): String? {
        if (!shared(Feature.CONTACTS) || number.isBlank()) return null
        return runCatching {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull()
    }

    // ------------------------------------------------------------ messages --

    private fun threads(): JSONArray {
        data class T(val id: String, val address: String, val snippet: String, val date: Long, var unread: Int)
        val byThread = LinkedHashMap<String, T>()
        runCatching {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf(Telephony.Sms.THREAD_ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.READ, Telephony.Sms.TYPE),
                null, null, "${Telephony.Sms.DATE} DESC",
            )?.use { c ->
                var scanned = 0
                // Newest first, so the first row seen for a thread is its latest message.
                while (c.moveToNext() && scanned++ < SCAN_SMS && byThread.size < MAX_THREADS) {
                    val id = c.getString(0) ?: continue
                    val t = byThread.getOrPut(id) { T(id, c.getString(1).orEmpty(), c.getString(2).orEmpty(), c.getLong(3), 0) }
                    if (c.getInt(4) == 0 && c.getInt(5) == Telephony.Sms.MESSAGE_TYPE_INBOX) t.unread++
                }
            }
        }
        val out = JSONArray()
        byThread.values.forEachIndexed { i, t ->
            val o = JSONObject().put("id", t.id).put("address", t.address).put("snippet", t.snippet.take(300)).put("date", t.date).put("unread", t.unread)
            // Names for the first screenful; the host matches the rest against contacts.
            if (i < 60) nameFor(t.address)?.let { o.put("name", it) }
            out.put(o)
        }
        return out
    }

    private fun messages(threadId: String): JSONObject? {
        if (threadId.any { !it.isDigit() }) return null
        val list = ArrayList<JSONObject>()
        var address = ""
        runCatching {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE, Telephony.Sms.TYPE),
                "${Telephony.Sms.THREAD_ID} = ?", arrayOf(threadId), "${Telephony.Sms.DATE} DESC",
            )?.use { c ->
                while (c.moveToNext() && list.size < MAX_MESSAGES) {
                    if (address.isEmpty()) address = c.getString(1).orEmpty()
                    list += JSONObject()
                        .put("id", c.getString(0))
                        .put("body", c.getString(2).orEmpty())
                        .put("date", c.getLong(3))
                        .put("outgoing", c.getInt(4) != Telephony.Sms.MESSAGE_TYPE_INBOX)
                }
            }
        }
        return JSONObject().put("threadId", threadId).put("address", address).put("messages", JSONArray(list.reversed()))
    }

    private fun sendSms(rawTo: String, body: String, ref: String) {
        val to = rawTo.filter { it.isDigit() || it == '+' }
        if (to.isEmpty() || body.isBlank()) {
            smsResult(ref, false, "No number or no text")
            return
        }
        val action = "com.axm.companion.SMS_SENT.$ref"
        val timeout = Runnable { smsResult(ref, false, "The phone's radio didn't answer") }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                main.removeCallbacks(timeout)
                runCatching { context.unregisterReceiver(this) }
                val ok = resultCode == Activity.RESULT_OK
                smsResult(ref, ok, if (ok) null else when (resultCode) {
                    SmsManager.RESULT_ERROR_NO_SERVICE -> "No mobile service"
                    SmsManager.RESULT_ERROR_RADIO_OFF -> "The phone is in flight mode"
                    else -> "The network refused it"
                })
            }
        }
        registerOwn(receiver, IntentFilter(action))
        main.postDelayed(timeout, 60_000)
        runCatching {
            val sms = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            val sent = PendingIntent.getBroadcast(context, ref.hashCode(), Intent(action).setPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT)
            val parts = sms.divideMessage(body.take(2000))
            if (parts.size <= 1) sms.sendTextMessage(to, null, body, sent, null)
            // The result that matters is the last part's: the text is only there when all of it is.
            else sms.sendMultipartTextMessage(to, null, parts, ArrayList(List(parts.size) { i -> if (i == parts.size - 1) sent else null }), null)
        }.onFailure {
            main.removeCallbacks(timeout)
            runCatching { context.unregisterReceiver(receiver) }
            smsResult(ref, false, it.message ?: "Couldn't send")
        }
    }

    private fun smsResult(ref: String, ok: Boolean, error: String?) {
        val o = JSONObject().put("ref", ref).put("ok", ok)
        error?.let { o.put("error", it) }
        send(Protocol.PHONE_SMS_RESULT, o)
    }

    // --------------------------------------------------------------- calls --

    private fun calls(): JSONArray {
        val out = JSONArray()
        runCatching {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.CACHED_NAME, CallLog.Calls.DATE, CallLog.Calls.DURATION, CallLog.Calls.TYPE),
                null, null, "${CallLog.Calls.DATE} DESC",
            )?.use { c ->
                while (c.moveToNext() && out.length() < MAX_CALLS) {
                    val kind = when (c.getInt(4)) {
                        CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                        CallLog.Calls.MISSED_TYPE -> "missed"
                        CallLog.Calls.REJECTED_TYPE, CallLog.Calls.BLOCKED_TYPE -> "rejected"
                        else -> "incoming"
                    }
                    val o = JSONObject().put("number", c.getString(0).orEmpty()).put("date", c.getLong(2)).put("durationSeconds", c.getLong(3)).put("kind", kind)
                    // The call log's cached name is a contact's name: only with Contacts shared.
                    if (shared(Feature.CONTACTS)) c.getString(1)?.takeIf { it.isNotBlank() }?.let { o.put("name", it) }
                    out.put(o)
                }
            }
        }
        return out
    }

    @SuppressLint("MissingPermission")
    private fun dial(raw: String) {
        val number = raw.filter { it.isDigit() || it in "+*#,;" }
        if (number.isEmpty()) return
        // Through telecom rather than an ACTION_CALL activity: it works with the app
        // in the background, and the phone's own in-call screen still takes over there.
        runCatching {
            val telecom = context.getSystemService(TelecomManager::class.java)
            telecom.placeCall(Uri.fromParts("tel", number, null), null)
        }
    }

    @SuppressLint("MissingPermission")
    private fun answer() {
        if (Build.VERSION.SDK_INT < 26) return
        runCatching { context.getSystemService(TelecomManager::class.java).acceptRingingCall() }
    }

    @SuppressLint("MissingPermission")
    private fun hangUp() {
        if (Build.VERSION.SDK_INT < 28) return
        @Suppress("DEPRECATION")
        runCatching { context.getSystemService(TelecomManager::class.java).endCall() }
    }

    // ------------------------------------------------------------ watchers --

    private var callReceiver: BroadcastReceiver? = null
    private var smsReceiver: BroadcastReceiver? = null
    private var smsObserver: ContentObserver? = null
    private var callObserver: ContentObserver? = null
    private var contactsObserver: ContentObserver? = null
    private val pushJobs = HashMap<String, Job>()

    /** Registers (or drops) the listeners for whatever is shared right now. */
    private fun registerWatchers() {
        val s = _status.value
        val calls = s.shared[Feature.CALLS] == true
        val messages = s.shared[Feature.MESSAGES] == true
        val contacts = s.shared[Feature.CONTACTS] == true

        if (calls && callReceiver == null) {
            callReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    val state = when (intent.getStringExtra(TelephonyManager.EXTRA_STATE)) {
                        TelephonyManager.EXTRA_STATE_RINGING -> "ringing"
                        TelephonyManager.EXTRA_STATE_OFFHOOK -> "offhook"
                        else -> "idle"
                    }
                    @Suppress("DEPRECATION")
                    val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                    // The broadcast comes twice when the number is readable (once without it); both are fine to forward.
                    scope.launch {
                        val o = JSONObject().put("state", state)
                        number?.takeIf { it.isNotBlank() }?.let { o.put("number", it); nameFor(it)?.let { n -> o.put("name", n) } }
                        if (connected) send(Protocol.PHONE_CALL_STATE, o)
                    }
                }
            }
            registerSystem(callReceiver!!, IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED))
        } else if (!calls && callReceiver != null) {
            runCatching { context.unregisterReceiver(callReceiver) }
            callReceiver = null
        }

        if (messages && smsReceiver == null) {
            smsReceiver = object : BroadcastReceiver() {
                override fun onReceive(ctx: Context, intent: Intent) {
                    val parts = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }.getOrNull() ?: return
                    val address = parts.firstOrNull()?.displayOriginatingAddress ?: return
                    val body = parts.joinToString("") { it.displayMessageBody ?: "" }
                    val date = parts.firstOrNull()?.timestampMillis ?: System.currentTimeMillis()
                    scope.launch {
                        // The default SMS app files it a moment later; its thread is what the host keys on.
                        delay(1500)
                        val threadId = runCatching { Telephony.Threads.getOrCreateThreadId(context, address).toString() }.getOrDefault("")
                        val o = JSONObject().put("threadId", threadId).put("address", address).put("body", body.take(5000)).put("date", date)
                        nameFor(address)?.let { o.put("name", it) }
                        if (connected) send(Protocol.PHONE_INCOMING_SMS, o)
                    }
                }
            }
            registerSystem(smsReceiver!!, IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION))
        } else if (!messages && smsReceiver != null) {
            runCatching { context.unregisterReceiver(smsReceiver) }
            smsReceiver = null
        }

        smsObserver = observe(messages, smsObserver, Telephony.Sms.CONTENT_URI, "threads")
        callObserver = observe(calls, callObserver, CallLog.Calls.CONTENT_URI, "calls")
        contactsObserver = observe(contacts, contactsObserver, ContactsContract.Contacts.CONTENT_URI, "contacts")
    }

    /** A provider changed: once it settles, the host gets the new list - if it asked for it. */
    private fun observe(on: Boolean, current: ContentObserver?, uri: Uri, what: String): ContentObserver? {
        if (!on) {
            current?.let { context.contentResolver.unregisterContentObserver(it) }
            return null
        }
        if (current != null) return current
        val observer = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean) {
                if (!connected || what !in subscribed) return
                pushJobs[what]?.cancel()
                pushJobs[what] = scope.launch {
                    delay(1200)
                    when (what) {
                        "threads" -> if (shared(Feature.MESSAGES)) send(Protocol.PHONE_THREADS, JSONObject().put("threads", threads()))
                        "calls" -> if (shared(Feature.CALLS)) send(Protocol.PHONE_CALLS, JSONObject().put("calls", calls()))
                        "contacts" -> if (shared(Feature.CONTACTS)) send(Protocol.PHONE_CONTACTS, JSONObject().put("contacts", contacts()))
                    }
                }
            }
        }
        runCatching { context.contentResolver.registerContentObserver(uri, true, observer) }
        return observer
    }

    /** Broadcasts only the system sends (calls, SMS). */
    private fun registerSystem(receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        else context.registerReceiver(receiver, filter)
    }

    /** Our own broadcasts (the SMS sent receipt). */
    private fun registerOwn(receiver: BroadcastReceiver, filter: IntentFilter) {
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(receiver, filter)
    }

    fun destroy() {
        for (f in listOf(callReceiver, smsReceiver)) f?.let { runCatching { context.unregisterReceiver(it) } }
        for (o in listOf(smsObserver, callObserver, contactsObserver)) o?.let { context.contentResolver.unregisterContentObserver(it) }
        callReceiver = null; smsReceiver = null; smsObserver = null; callObserver = null; contactsObserver = null
    }

    private companion object {
        const val MAX_CONTACTS = 5000
        const val MAX_PHOTOS = 600
        const val PHOTO_PX = 96
        const val MAX_THREADS = 300
        const val SCAN_SMS = 20_000
        const val MAX_MESSAGES = 300
        const val MAX_CALLS = 300
    }
}
