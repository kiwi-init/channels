package com.kiwiinit.channels.model

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.os.Build
import android.provider.Settings
import android.util.Base64
import android.util.LruCache
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.core.content.edit
import androidx.core.net.toUri
import com.kiwiinit.channels.engine.ComputerView
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.Engine
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.EnrollDigits
import com.kiwiinit.channels.engine.EnrollPerson
import com.kiwiinit.channels.engine.EnrollStart
import com.kiwiinit.channels.engine.HarnessesOn
import com.kiwiinit.channels.engine.Launched
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.Push
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.engine.wire
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

sealed interface Phase {
    data object Starting : Phase

    data object Unlinked : Phase

    data object Ready : Phase

    data class Broken(val why: String) : Phase
}

sealed interface Linking {
    data object Idle : Linking

    data class SigningIn(val url: String?, val code: String) : Linking

    data object Asking : Linking

    data class Approve(val digits: String) : Linking

    data class Check(val name: String, val fingerprint: String) : Linking

    data class Failed(val why: String) : Linking
}

const val DEFAULT_RELAY = "https://channels.kiwiinit.com"

enum class Buzz { Tap, Warn, Fail, Done }

class Attached(val id: String, val image: ImageBitmap, val data: ByteArray, val mime: String)

data class Draft(val text: String = "", val attached: List<Attached> = emptyList()) {
    val isEmpty: Boolean get() = text.isBlank() && attached.isEmpty()
}

class Outgoing(val name: String, val mime: String, val data: String)

data class Pending(val id: String, val body: String, val re: Int?, val at: Long, val seq: Int? = null, val failed: Boolean = false)

data class Feed(val messages: List<MessageView>, val whole: Boolean)

data class LaunchSeen(val stage: String, val name: String)

data class AgentChoices(val nick: String? = null, val model: String? = null, val effort: String? = null, val permission: String? = null, val context: Int? = null)

class AppModel(private val app: Application) {
    private val scope = MainScope()
    private val prefs = app.getSharedPreferences("channels", Context.MODE_PRIVATE)
    private val pictures = LruCache<String, ImageBitmap>(48)
    private var booted = false

    val vault = Vault(app)
    val lock = Lock(app, vault.exists())
    val buzz = MutableSharedFlow<Buzz>(extraBufferCapacity = 8)

    var engine by mutableStateOf<Engine?>(null)
        private set
    var phase by mutableStateOf<Phase>(Phase.Starting)
        private set
    var person by mutableStateOf("")
        private set
    var relay by mutableStateOf("")
        private set
    var enrolled by mutableStateOf(false)
        private set
    var waiting by mutableStateOf(0)
        private set
    var linking by mutableStateOf<Linking>(Linking.Idle)
        private set
    var relinkAsked by mutableStateOf(false)
    var unsaved by mutableStateOf<String?>(null)
        private set
    private var keeping: ByteArray? = null

    val rooms = mutableStateMapOf<String, RoomView>()
    val seen = mutableStateMapOf<String, Int>().apply { putAll(counts("seen")) }
    val placeSeen = mutableStateMapOf<String, Int>().apply { putAll(counts("placeSeen")) }
    val pinned = mutableStateListOf<String>().apply { addAll(names("pinned")) }
    val drafts = mutableStateMapOf<String, Draft>()
    val feeds = mutableStateMapOf<String, Feed>()
    val pending = mutableStateMapOf<String, List<Pending>>()
    val sentAs = mutableStateMapOf<Int, String>()
    val visited = mutableStateListOf<Spot>()
    val launches = mutableStateMapOf<String, LaunchSeen>()

    val relinking: Boolean
        get() = phase == Phase.Ready && (relinkAsked || linking != Linking.Idle)

    val channels: List<RoomView>
        get() = rooms.values.filter { it.gone == null }.sortedByDescending { (it.latest ?: it.last)?.at ?: 0.0 }

    fun boot() {
        if (booted) return
        booted = true
        scope.launch {
            if (!startEngine()) return@launch
            val saved = vault.load()
            if (saved == null) phase = Phase.Unlinked else begin(saved)
        }
    }

    private suspend fun startEngine(): Boolean {
        val next = Engine(app, ::take, ::lost)
        engine = next
        return try {
            next.load()
            true
        } catch (e: EngineException) {
            phase = Phase.Broken(e.message ?: "The engine didn't start.")
            false
        }
    }

    private fun lost() {
        val old = engine ?: return
        engine = null
        old.destroy()
        scope.launch {
            if (!startEngine()) return@launch
            val saved = vault.load() ?: return@launch
            begin(saved)
        }
    }

    private suspend fun begin(saved: ByteArray) {
        val obj = try {
            wire.parseToJsonElement(saved.decodeToString()).jsonObject
        } catch (e: IllegalArgumentException) {
            // Keys this build can't read are as good as none: this phone links again.
            phase = Phase.Unlinked
            return
        }
        relay = (obj["relay"] as? JsonPrimitive)?.contentOrNull ?: ""
        held(obj)
        try {
            ask(
                buildJsonObject {
                    put("op", "start")
                    put("saved", obj)
                },
            )
            phase = Phase.Ready
        } catch (e: EngineException) {
            phase = Phase.Broken(e.message ?: "The engine didn't start.")
        }
    }

    private fun held(saved: JsonObject) {
        val device = saved["device"] as? JsonObject
        val owner = (saved["person"] as? JsonObject) ?: (device?.get("person") as? JsonObject)
        person = (owner?.get("name") as? JsonPrimitive)?.contentOrNull ?: ""
        enrolled = device != null
        waiting = (saved["seats"] as? JsonArray).orEmpty().count { seat ->
            val o = seat as? JsonObject
            o != null && o["requestId"] != null && (o["access"] == null || o["access"] is JsonNull)
        }
    }

    private suspend fun ask(request: JsonObject) = (engine ?: throw EngineException("Channels is still starting.")).ask(request)

    private fun take(push: Push) {
        when (push) {
            is Push.Saved -> {
                store(push.saved.toString().toByteArray())
                (push.saved as? JsonObject)?.let(::held)
            }
            is Push.Room -> {
                val room = push.room
                val before = rooms[room.code]
                if (before != null && before.connection == Connection.Live) {
                    val known = before.asks.map { it.seq }.toSet()
                    val reviewed = before.reviews.map { it.task }.toSet()
                    if (room.asks.any { it.seq !in known } || room.reviews.any { it.task !in reviewed }) buzz.tryEmit(Buzz.Warn)
                }
                feeds["${room.code}|${room.place}"] = Feed(room.messages, room.whole)
                rooms[room.code] = room
                settle(room.code)
            }
            is Push.Gone -> rooms.remove(push.code)
            is Push.Log, is Push.Fetch -> Unit
            is Push.Launch -> launches[push.launch] = LaunchSeen(push.stage, push.name)
            is Push.Removed -> {
                unlink()
                linking = Linking.Failed("This phone was removed from your devices by ${push.by}, so it deleted its keys and channels. Sign in to add it again.")
            }
        }
    }

    fun fresh(room: RoomView, key: String): Boolean {
        val place = room.placeView(key) ?: return false
        val last = place.last ?: return false
        if (last.mine) return false
        val mark = if (key == "main") seen[room.code] ?: 0 else placeSeen["${room.code}|$key"] ?: 0
        return place.lastSeq > mark
    }

    fun draft(spot: Spot): Draft = drafts[spot.id] ?: Draft()

    fun keep(draft: Draft, spot: Spot) {
        if (draft.isEmpty) drafts.remove(spot.id) else drafts[spot.id] = draft
    }

    fun open(code: String) {
        scope.launch {
            try {
                ask(
                    buildJsonObject {
                        put("op", "open")
                        put("code", code)
                        put("place", "main")
                    },
                )
            } catch (e: EngineException) {
                // A channel that isn't on this phone has nothing to open; its screen says so.
            }
        }
    }

    fun signIn() {
        scope.launch {
            linking = Linking.SigningIn(null, "")
            try {
                val started = read(
                    EnrollStart.serializer(),
                    ask(
                        buildJsonObject {
                            put("op", "enrollBegin")
                            put("relay", relay.ifEmpty { DEFAULT_RELAY })
                            put("label", deviceName())
                            put("os", "Android ${Build.VERSION.RELEASE}")
                        },
                    ),
                )
                linking = Linking.SigningIn(started.url, started.code)
                started.url?.let(::browse)
                ask(buildJsonObject { put("op", "enrollAsk") })
                linking = Linking.Asking
                val shown = read(EnrollDigits.serializer(), ask(buildJsonObject { put("op", "enrollWait") }))
                linking = Linking.Approve(shown.digits)
                val person = read(EnrollPerson.serializer(), ask(buildJsonObject { put("op", "enrollCheck") }))
                linking = Linking.Check(person.name, person.fingerprint)
            } catch (e: EngineException) {
                if (linking != Linking.Idle) linking = Linking.Failed(e.message ?: "Signing in didn't work. Try again.")
            }
        }
    }

    fun keepLink() {
        scope.launch {
            try {
                val data = ask(buildJsonObject { put("op", "enrollFinish") }).toString().toByteArray()
                store(data)
                linking = Linking.Idle
                rooms.clear()
                begin(data)
            } catch (e: EngineException) {
                if (linking != Linking.Idle) linking = Linking.Failed(e.message ?: "Signing in didn't work. Try again.")
            }
        }
    }

    fun refuseLink(fingerprint: String) {
        linking = Linking.Failed(
            "Kept nothing. If your computer never showed $fingerprint, someone else answered this phone. Your computer may still list it under Devices: remove it there.",
        )
        scope.launch {
            try {
                ask(buildJsonObject { put("op", "enrollCancel") })
            } catch (e: EngineException) {
                // The ask already ran out on the relay: there's nothing left to drop.
            }
        }
    }

    fun browse(url: String) {
        try {
            app.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: ActivityNotFoundException) {
            // No browser on this phone: the screen still shows the address and its code to type elsewhere.
        }
    }

    fun cancelLink() {
        linking = Linking.Idle
        relinkAsked = false
        scope.launch {
            try {
                ask(buildJsonObject { put("op", "enrollCancel") })
            } catch (e: EngineException) {
                // Nothing was waiting: there's nothing to cancel.
            }
        }
    }

    suspend fun send(spot: Spot, body: String, re: Int?, pictures: List<Outgoing> = emptyList()): Int {
        val value = ask(
            buildJsonObject {
                put("op", "send")
                put("code", spot.code)
                put("place", spot.place)
                put("body", body)
                put("re", re?.let { JsonPrimitive(it) } ?: JsonNull)
                putJsonArray("imgs") {
                    for (p in pictures) {
                        addJsonObject {
                            put("name", p.name)
                            put("mime", p.mime)
                            put("data", p.data)
                        }
                    }
                }
            },
        )
        return (value as? JsonPrimitive)?.intOrNull ?: 0
    }

    suspend fun image(code: String, seq: Int, index: Int): ImageBitmap? {
        val key = "$code/$seq/$index"
        pictures.get(key)?.let { return it }
        val value = try {
            ask(
                buildJsonObject {
                    put("op", "image")
                    put("code", code)
                    put("seq", seq)
                    put("index", index)
                },
            )
        } catch (e: EngineException) {
            // The picture shows as unavailable; opening the conversation again asks once more.
            return null
        }
        val text = (value as? JsonPrimitive)?.contentOrNull ?: return null
        val image = withContext(Dispatchers.Default) { decodePicture(text) } ?: return null
        pictures.put(key, image)
        return image
    }

    suspend fun react(code: String, seq: Int, emoji: String?) {
        ask(
            buildJsonObject {
                put("op", "react")
                put("code", code)
                put("seq", seq)
                put("emoji", emoji?.let { JsonPrimitive(it) } ?: JsonNull)
            },
        )
    }

    suspend fun answer(code: String, seq: Int, text: String) {
        ask(
            buildJsonObject {
                put("op", "answer")
                put("code", code)
                put("seq", seq)
                put("text", text)
            },
        )
    }

    suspend fun approve(code: String, task: Int) {
        ask(
            buildJsonObject {
                put("op", "approve")
                put("code", code)
                put("task", task)
            },
        )
    }

    suspend fun sendBack(code: String, task: Int, why: String) {
        ask(
            buildJsonObject {
                put("op", "sendBack")
                put("code", code)
                put("task", task)
                put("why", why)
            },
        )
    }

    suspend fun computers(): List<ComputerView> = read(ListSerializer(ComputerView.serializer()), ask(buildJsonObject { put("op", "computers") }))

    suspend fun harnesses(computer: String): HarnessesOn =
        read(
            HarnessesOn.serializer(),
            ask(
                buildJsonObject {
                    put("op", "harnessesOn")
                    put("computer", computer)
                },
            ),
        )

    suspend fun folders(computer: String, code: String): List<String> =
        read(
            ListSerializer(String.serializer()),
            ask(
                buildJsonObject {
                    put("op", "foldersOn")
                    put("computer", computer)
                    put("code", code)
                },
            ),
        )

    suspend fun launch(code: String, computer: String, harness: String, folder: String, choices: AgentChoices): Launched =
        read(
            Launched.serializer(),
            ask(
                buildJsonObject {
                    put("op", "launch")
                    put("code", code)
                    put("computer", computer)
                    put("harness", harness)
                    put("folder", folder)
                    choices.nick?.let { put("nick", it) }
                    choices.model?.let { put("model", it) }
                    choices.effort?.let { put("effort", it) }
                    choices.permission?.let { put("permission", it) }
                    choices.context?.let { put("context", it) }
                },
            ),
        )

    private fun <T> read(serializer: KSerializer<T>, value: JsonElement): T =
        try {
            wire.decodeFromJsonElement(serializer, value)
        } catch (e: IllegalArgumentException) {
            // An answer in a shape this build doesn't know reads as a failed ask, so the screen offers to try again.
            throw EngineException("Your computer answered in a way this app doesn't know yet. Update Channels on this phone.")
        }

    fun later(block: suspend () -> Unit) {
        scope.launch {
            try {
                block()
            } catch (e: EngineException) {
                // Reactions and quick answers are best effort: the conversation shows what really landed.
                buzz.tryEmit(Buzz.Fail)
            }
        }
    }

    private fun store(data: ByteArray) {
        try {
            vault.save(data)
            keeping = null
            unsaved = null
        } catch (e: VaultException) {
            // The session runs from memory: the notice says so, and the next start or push saves again.
            keeping = data
            unsaved = "This phone couldn't save your sign-in: ${e.message}. You stay signed in until Channels closes, and it tries again each time you open it."
        }
    }

    fun nudge() {
        keeping?.let(::store)
        if (phase != Phase.Ready) return
        scope.launch {
            try {
                ask(buildJsonObject { put("op", "nudge") })
            } catch (e: EngineException) {
                // The keyring reconnects on its own; a nudge only hurries it.
            }
        }
    }

    fun unlink() {
        vault.wipe()
        keeping = null
        unsaved = null
        rooms.clear()
        person = ""
        enrolled = false
        waiting = 0
        phase = Phase.Unlinked
        val keep = relay
        scope.launch {
            try {
                ask(
                    buildJsonObject {
                        put("op", "start")
                        put(
                            "saved",
                            buildJsonObject {
                                put("relay", keep)
                                put("person", JsonNull)
                                put("seats", buildJsonArray {})
                            },
                        )
                    },
                )
            } catch (e: EngineException) {
                // The keys are gone from this phone already; the engine stops with the app.
            }
        }
    }

    fun isPinned(spot: Spot): Boolean = spot.id in pinned

    fun togglePin(spot: Spot) {
        if (!pinned.remove(spot.id)) pinned.add(spot.id)
        prefs.edit { putString("pinned", wire.encodeToString(ListSerializer(String.serializer()), pinned.toList())) }
    }

    fun unread(spot: Spot): Boolean {
        val room = rooms[spot.code] ?: return false
        return fresh(room, spot.place)
    }

    fun markRead(spot: Spot) {
        val room = rooms[spot.code] ?: return
        val top = room.placeView(spot.place)?.lastSeq ?: return
        if (spot.general) {
            if (top <= (seen[spot.code] ?: 0)) return
            seen[spot.code] = top
            saveCounts("seen", seen)
        } else {
            if (top <= (placeSeen[spot.id] ?: 0)) return
            placeSeen[spot.id] = top
            saveCounts("placeSeen", placeSeen)
        }
    }

    fun markUnread(spot: Spot) {
        val room = rooms[spot.code] ?: return
        val last = room.placeView(spot.place)?.last ?: return
        if (last.mine) return
        if (spot.general) {
            seen[spot.code] = last.seq - 1
            saveCounts("seen", seen)
        } else {
            placeSeen[spot.id] = last.seq - 1
            saveCounts("placeSeen", placeSeen)
        }
    }

    fun markAllRead() {
        for (row in rows(Filter.Unread)) markRead(row.spot)
    }

    fun shown(spot: Spot): RoomView? {
        val room = rooms[spot.code] ?: return null
        if (spot.place == room.sideKey) return room.showing(spot.place, Feed(room.side ?: emptyList(), room.whole))
        return if (room.place == "main") room else room.showing("main", feeds[spot.id])
    }

    fun visit(spot: Spot) {
        visited.remove(spot)
        visited.add(0, spot)
        while (visited.size > 12) visited.removeAt(visited.size - 1)
    }

    fun post(spot: Spot, body: String, re: Int?) {
        val item = Pending(id = UUID.randomUUID().toString(), body = body, re = re, at = System.currentTimeMillis())
        pending[spot.id] = (pending[spot.id] ?: emptyList()) + item
        deliver(item, spot)
    }

    fun retry(item: Pending, spot: Spot) {
        val list = pending[spot.id] ?: return
        if (list.none { it.id == item.id }) return
        pending[spot.id] = list.map { if (it.id == item.id) it.copy(failed = false) else it }
        deliver(item, spot)
    }

    fun drop(item: Pending, spot: Spot) {
        pending[spot.id] = (pending[spot.id] ?: emptyList()).filter { it.id != item.id }
    }

    private fun deliver(item: Pending, spot: Spot) {
        scope.launch {
            try {
                val seq = send(spot, item.body, item.re)
                sentAs[seq] = item.id
                pending[spot.id] = (pending[spot.id] ?: emptyList()).map { if (it.id == item.id) it.copy(seq = seq) else it }
                settle(spot.code)
            } catch (e: EngineException) {
                pending[spot.id] = (pending[spot.id] ?: emptyList()).map { if (it.id == item.id) it.copy(failed = true) else it }
                buzz.tryEmit(Buzz.Fail)
            }
        }
    }

    fun settle(code: String) {
        val room = rooms[code] ?: return
        val have = (room.messages.map { it.seq } + (room.side ?: emptyList()).map { it.seq }).toSet()
        for (key in listOf("main") + listOfNotNull(room.sideKey)) {
            val id = "$code|$key"
            val list = pending[id] ?: continue
            if (list.isEmpty()) continue
            val kept = list.filter { item -> item.seq?.let { it !in have } ?: true }
            if (kept.size != list.size) pending[id] = kept
        }
    }

    private fun deviceName(): String =
        Settings.Global.getString(app.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: "${Build.MANUFACTURER} ${Build.MODEL}"

    private fun counts(key: String): Map<String, Int> {
        val text = prefs.getString(key, null) ?: return emptyMap()
        return try {
            wire.decodeFromString(MapSerializer(String.serializer(), Int.serializer()), text)
        } catch (e: IllegalArgumentException) {
            // Read marks are a convenience: a garbled set starts over.
            emptyMap()
        }
    }

    private fun names(key: String): List<String> {
        val text = prefs.getString(key, null) ?: return emptyList()
        return try {
            wire.decodeFromString(ListSerializer(String.serializer()), text)
        } catch (e: IllegalArgumentException) {
            // Pins are a convenience: a garbled list starts over.
            emptyList()
        }
    }

    private fun saveCounts(key: String, map: Map<String, Int>) {
        prefs.edit { putString(key, wire.encodeToString(MapSerializer(String.serializer(), Int.serializer()), map.toMap())) }
    }

    private fun decodePicture(text: String): ImageBitmap? {
        val raw = try {
            Base64.decode(text, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            // Not a picture the engine could have sent: it shows as unavailable.
            return null
        }
        return BitmapFactory.decodeByteArray(raw, 0, raw.size)?.asImageBitmap()
    }
}
