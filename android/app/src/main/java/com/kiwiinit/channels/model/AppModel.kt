package com.kiwiinit.channels.model

import android.app.Application
import android.content.Context
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
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.Engine
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.LinkStart
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
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
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

    data object Asking : Linking

    data class Digits(val digits: String) : Linking

    data class Failed(val why: String) : Linking
}

enum class Buzz { Tap, Warn, Fail, Done }

class Attached(val id: String, val image: ImageBitmap, val data: ByteArray)

data class Draft(val text: String = "", val attached: List<Attached> = emptyList()) {
    val isEmpty: Boolean get() = text.isBlank() && attached.isEmpty()
}

class Outgoing(val name: String, val mime: String, val data: String)

data class Pending(val id: String, val body: String, val re: Int?, val at: Long, val seq: Int? = null, val failed: Boolean = false)

data class Feed(val messages: List<MessageView>, val whole: Boolean)

class AppModel(private val app: Application) {
    private val scope = MainScope()
    private val prefs = app.getSharedPreferences("channels", Context.MODE_PRIVATE)
    private val pictures = LruCache<String, ImageBitmap>(48)
    private var booted = false
    private var waitingLink: String? = null

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
    var linking by mutableStateOf<Linking>(Linking.Idle)
        private set
    var relinkAsked by mutableStateOf(false)

    val rooms = mutableStateMapOf<String, RoomView>()
    val seen = mutableStateMapOf<String, Int>().apply { putAll(counts("seen")) }
    val placeSeen = mutableStateMapOf<String, Int>().apply { putAll(counts("placeSeen")) }
    val pinned = mutableStateListOf<String>().apply { addAll(names("pinned")) }
    val drafts = mutableStateMapOf<String, Draft>()
    val feeds = mutableStateMapOf<String, Feed>()
    val pending = mutableStateMapOf<String, List<Pending>>()
    val sentAs = mutableStateMapOf<Int, String>()
    val visited = mutableStateListOf<Spot>()

    val relinking: Boolean
        get() = phase == Phase.Ready && (relinkAsked || linking != Linking.Idle)

    val channels: List<RoomView>
        get() = rooms.values.filter { it.gone == null }.sortedByDescending { it.last?.at ?: 0.0 }

    fun boot() {
        if (booted) return
        booted = true
        scope.launch {
            if (!startEngine()) return@launch
            val saved = vault.load()
            if (saved == null) phase = Phase.Unlinked else begin(saved)
            waitingLink?.let {
                waitingLink = null
                link(it)
            }
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
        person = ((obj["person"] as? JsonObject)?.get("name") as? JsonPrimitive)?.contentOrNull ?: ""
        relay = (obj["relay"] as? JsonPrimitive)?.contentOrNull ?: ""
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

    private suspend fun ask(request: JsonObject) = (engine ?: throw EngineException("Channels is still starting.")).ask(request)

    private fun take(push: Push) {
        when (push) {
            is Push.Saved -> vault.save(push.saved.toString().toByteArray())
            is Push.Room -> {
                val room = push.room
                val before = rooms[room.code]
                if (before != null && before.connection == Connection.Live) {
                    val known = before.asks.map { it.seq }.toSet()
                    if (room.asks.any { it.seq !in known }) buzz.tryEmit(Buzz.Warn)
                }
                feeds["${room.code}|${room.place}"] = Feed(room.messages, room.whole)
                rooms[room.code] = room
                settle(room.code)
            }
            is Push.Gone -> rooms.remove(push.code)
            is Push.Log -> Unit
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

    fun linkWhenReady(code: String) {
        if (phase == Phase.Starting) waitingLink = code else link(code)
    }

    fun link(code: String) {
        scope.launch {
            linking = Linking.Asking
            try {
                val started = wire.decodeFromJsonElement(
                    LinkStart.serializer(),
                    ask(
                        buildJsonObject {
                            put("op", "linkAsk")
                            put("code", code.trim())
                            put("label", deviceName())
                        },
                    ),
                )
                linking = Linking.Digits(started.digits)
                val data = ask(buildJsonObject { put("op", "linkWait") }).toString().toByteArray()
                vault.save(data)
                linking = Linking.Idle
                relinkAsked = false
                rooms.clear()
                begin(data)
            } catch (e: EngineException) {
                linking = Linking.Failed(e.message ?: "Linking didn't work. Start again from Link a phone.")
            } catch (e: IllegalArgumentException) {
                linking = Linking.Failed("The engine answered something this app can't read. Start again from Link a phone.")
            }
        }
    }

    fun cancelLink() {
        linking = Linking.Idle
        relinkAsked = false
        scope.launch {
            try {
                ask(buildJsonObject { put("op", "linkCancel") })
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

    fun nudge() {
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
        rooms.clear()
        person = ""
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
        prefs.edit().putString("pinned", wire.encodeToString(ListSerializer(String.serializer()), pinned.toList())).apply()
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
        prefs.edit().putString(key, wire.encodeToString(MapSerializer(String.serializer(), Int.serializer()), map.toMap())).apply()
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
