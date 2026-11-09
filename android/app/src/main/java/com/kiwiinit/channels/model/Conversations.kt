package com.kiwiinit.channels.model

import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.listSaver
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.PlaceView
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView

data class Spot(val code: String, val place: String = "main") {
    val id: String get() = "$code|$place"
    val general: Boolean get() = place == "main"

    companion object {
        val saver: Saver<Spot, Any> = listSaver(save = { listOf(it.code, it.place) }, restore = { Spot(it[0], it[1]) })
    }
}

enum class RowKind { Group, Lead, Room }

enum class Filter(val title: String) {
    All("All"),
    Needs("Needs you"),
    Unread("Unread"),
}

data class Row(
    val spot: Spot,
    val kind: RowKind,
    val room: RoomView,
    val place: PlaceView?,
    val title: String,
    val qualifier: String?,
    val unread: Boolean,
    val asks: List<AskView>,
    val reviews: List<ReviewView>,
    val draft: Draft?,
) {
    val id: String get() = spot.id
    val last: MessageView? get() = place?.last
    val lastAt: Double get() = last?.at ?: 0.0
    val needs: Int get() = asks.size + reviews.size
    val need: String? get() = (asks.firstOrNull()?.plain ?: reviews.firstOrNull()?.let { "${taskLabel(it.task)} ${it.title}" })?.oneLine()
    val lead: String? get() = if (kind == RowKind.Lead) room.lead else null

    val working: Boolean
        get() = when (kind) {
            RowKind.Group -> room.working > 0
            RowKind.Lead -> lead?.let { room.member(it) }?.working ?: false
            RowKind.Room -> false
        }

    val fullTitle: String get() = qualifier?.let { "$title · $it" } ?: title

    val line: String
        get() {
            if (room.connection == Connection.Connecting && last == null) return "Connecting…"
            need?.let { return "Needs you: $it" }
            draft?.let { return "Draft: ${if (it.text.isEmpty()) "Photo" else it.text.oneLine()}" }
            val newest = last ?: return if (kind == RowKind.Lead) "Message your lead" else "No messages yet"
            val body = if (newest.body.isEmpty() && newest.images > 0) {
                if (newest.images == 1) "Photo" else "${newest.images} Photos"
            } else {
                newest.plain.oneLine()
            }
            if (kind == RowKind.Lead) return if (newest.mine) "You: $body" else body
            return "${if (newest.mine) "You" else room.display(newest.from)}: $body"
        }
}

data class TaskCounts(val working: Int, val review: Int, val todo: Int) {
    val line: String
        get() = listOfNotNull(
            if (working > 0) "$working working" else null,
            if (review > 0) "$review in review" else null,
            if (todo > 0) "$todo to do" else null,
        ).joinToString(" · ").ifEmpty { "Nothing open" }

    companion object {
        fun of(room: RoomView): TaskCounts {
            val live = room.tasks.filter { !it.archived }
            return TaskCounts(live.count { it.state == "doing" }, live.count { it.state == "review" }, live.count { it.state == "todo" })
        }
    }
}

fun String.oneLine(): String = replace("\n", " ")

fun taskLabel(id: Int): String = "T$id"

val RoomView.leadSpot: Spot? get() = sideKey?.let { Spot(code, it) }

fun RoomView.other(than: Spot): Spot? = if (than.general) leadSpot else Spot(code)

fun isRoomKey(key: String): Boolean = key.startsWith("room:")

fun RoomView.asksIn(key: String): List<AskView> =
    if (key == sideKey || isRoomKey(key)) asks.filter { it.place == key } else asks.filter { it.place != sideKey && it.place?.let(::isRoomKey) != true }

fun RoomView.elsewhere(): List<AskView> = asks.filter { it.place != "main" && it.place != sideKey && it.place?.let(::isRoomKey) != true }

val RoomView.roomPlaces: List<PlaceView> get() = places.filter { it.kind == "room" }

fun RoomView.showing(key: String, feed: Feed?): RoomView = copy(place = key, messages = feed?.messages ?: emptyList(), whole = feed?.whole ?: false)

fun RoomView.spotTitle(key: String): String {
    if (isRoomKey(key)) return "# ${placeView(key)?.title ?: "room"}"
    if (key.startsWith("task:")) return placeView(key)?.title ?: key.removePrefix("task:").let { "T$it" }
    val head = lead
    if (key == "main" || head == null) return title
    return display(head)
}

fun AppModel.section(room: RoomView, many: Boolean): List<Row> {
    val out = mutableListOf<Row>()
    val spot = room.leadSpot
    val lead = room.lead
    if (spot != null && lead != null) {
        out += Row(
            spot = spot,
            kind = RowKind.Lead,
            room = room,
            place = room.placeView(spot.place),
            title = room.display(lead),
            qualifier = if (many) room.title else null,
            unread = fresh(room, spot.place),
            asks = room.asksIn(spot.place),
            reviews = emptyList(),
            draft = drafts[spot.id],
        )
    }
    val general = Spot(room.code)
    out += Row(
        spot = general,
        kind = RowKind.Group,
        room = room,
        place = room.placeView("main"),
        title = "# general",
        qualifier = if (many) room.title else null,
        unread = fresh(room, "main"),
        asks = room.asksIn("main"),
        reviews = room.reviews,
        draft = drafts[general.id],
    )
    for (place in room.roomPlaces) {
        val at = Spot(room.code, place.key)
        out += Row(
            spot = at,
            kind = RowKind.Room,
            room = room,
            place = place,
            title = "# ${place.title}",
            qualifier = if (many) room.title else null,
            unread = fresh(room, place.key),
            asks = room.asksIn(place.key),
            reviews = emptyList(),
            draft = drafts[at.id],
        )
    }
    return out
}

fun AppModel.rows(filter: Filter = Filter.All): List<Row> {
    val live = channels
    val out = live.flatMap { section(it, live.size > 1) }
    val kept = when (filter) {
        Filter.All -> out
        Filter.Needs -> out.filter { it.needs > 0 }
        Filter.Unread -> out.filter { it.unread }
    }
    return kept.sortedWith(compareByDescending<Row> { it.lastAt }.thenByDescending { it.title })
}

fun AppModel.row(spot: Spot): Row? = rows(Filter.All).firstOrNull { it.spot == spot }

val AppModel.needing: Int get() = channels.sumOf { it.asks.size + it.reviews.size }
