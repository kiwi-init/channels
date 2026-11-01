package com.kiwiinit.channels.engine

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

val wire = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

@Serializable
enum class Connection {
    @SerialName("connecting") Connecting,
    @SerialName("live") Live,
    @SerialName("reconnecting") Reconnecting,
}

@Serializable
data class ActivityView(val state: String, val tool: String? = null, val since: Double? = null)

@Serializable
data class MemberView(
    val name: String,
    val display: String,
    val kind: String,
    val role: String? = null,
    val owner: Boolean = false,
    val lead: Boolean = false,
    val color: String? = null,
    val here: Boolean = false,
    val activity: ActivityView? = null,
    val sponsor: String? = null,
    val model: String? = null,
    val harness: String? = null,
    val mono: Boolean = false,
    val doing: List<Int> = emptyList(),
) {
    val isAgent: Boolean get() = kind == "agent"
    val working: Boolean get() = activity?.state == "working"
}

@Serializable
data class QuoteView(val seq: Int, val from: String, val words: String)

@Serializable
data class Chosen(val choice: String, val by: String)

@Serializable
data class ReactionView(val emoji: String, val who: List<String> = emptyList(), val mine: Boolean = false)

@Serializable
data class MessageView(
    val seq: Int,
    val from: String,
    val at: Double,
    val kind: String,
    val body: String,
    val event: Boolean = false,
    val mine: Boolean = false,
    val quote: QuoteView? = null,
    val choices: List<String> = emptyList(),
    val chosen: Chosen? = null,
    val waiting: Boolean = false,
    val images: Int = 0,
    val task: Int? = null,
    val reactions: List<ReactionView> = emptyList(),
    val shown: String = body,
    val plain: String = body,
) {
    val myReaction: String? get() = reactions.firstOrNull { it.mine }?.emoji
    val millis: Long get() = at.toLong()
}

@Serializable
data class TaskView(
    val id: Int,
    val title: String,
    val state: String,
    val owner: String? = null,
    val review: String? = null,
    val updatedAt: Double = 0.0,
    val createdAt: Double = 0.0,
    val last: String? = null,
    val archived: Boolean = false,
)

@Serializable
data class AskView(
    val seq: Int,
    val from: String,
    val body: String,
    val at: Double,
    val label: String,
    val choices: List<String> = emptyList(),
    val task: Int? = null,
    val place: String? = null,
    val shown: String = body,
    val plain: String = body,
) {
    val millis: Long get() = at.toLong()
}

@Serializable
data class ReviewView(
    val task: Int,
    val title: String,
    val by: String? = null,
    val at: Double,
) {
    val millis: Long get() = at.toLong()
}

@Serializable
data class PlaceView(
    val key: String,
    val kind: String,
    val title: String,
    val with: List<String> = emptyList(),
    val withMe: Boolean = true,
    val task: Int? = null,
    val lastSeq: Int = 0,
    val last: MessageView? = null,
)

@Serializable
data class IconView(
    val kind: String,
    val robot: String? = null,
    val emoji: String? = null,
    val mime: String? = null,
    val data: String? = null,
)

@Serializable
data class RoomView(
    val code: String,
    val title: String,
    val icon: IconView? = null,
    val me: String,
    val isOwner: Boolean = false,
    val connection: Connection = Connection.Connecting,
    val gone: String? = null,
    val error: String? = null,
    val head: Int = 0,
    val whole: Boolean = false,
    val hold: String? = null,
    val charter: String? = null,
    val lead: String? = null,
    val members: List<MemberView> = emptyList(),
    val messages: List<MessageView> = emptyList(),
    val side: List<MessageView>? = null,
    val sideKey: String? = null,
    val tasks: List<TaskView> = emptyList(),
    val asks: List<AskView> = emptyList(),
    val reviews: List<ReviewView> = emptyList(),
    val last: MessageView? = null,
    val latest: MessageView? = null,
    val latestIn: String = "main",
    val place: String = "main",
    val places: List<PlaceView> = emptyList(),
) {
    fun placeView(key: String): PlaceView? = places.firstOrNull { it.key == key }

    fun other(place: PlaceView): String? = if (place.kind == "dm" && place.withMe) place.with.firstOrNull { it != me } else null

    fun member(name: String): MemberView? = members.firstOrNull { it.name == name }

    fun display(name: String): String = member(name)?.display ?: name

    val working: Int get() = members.count { it.isAgent && it.working }
}

@Serializable
data class ComputerView(
    val key: String,
    val xpk: String,
    val label: String = "",
    val online: Boolean = false,
    val since: Double? = null,
    val seenAt: Double = 0.0,
) {
    val name: String get() = label.ifEmpty { "Your computer" }
}

@Serializable
data class HarnessOptions(
    val model: Boolean = false,
    val effort: List<String> = emptyList(),
    val permission: List<String> = emptyList(),
    val context: List<Int> = emptyList(),
)

@Serializable
data class HarnessChoice(
    val harness: String,
    val name: String,
    val face: String = "",
    val mono: Boolean = false,
    val version: String? = null,
    val start: Boolean = false,
    val why: String? = null,
    val options: HarnessOptions? = null,
)

@Serializable
data class HarnessesOn(val harnesses: List<HarnessChoice>, val bypass: Boolean = false)

@Serializable
data class Launched(val ok: Boolean, val launch: String? = null, val detail: String? = null)

@Serializable
data class EnrollStart(val url: String? = null, val code: String = "")

@Serializable
data class EnrollDigits(val digits: String)

@Serializable
data class EnrollPerson(val name: String, val fingerprint: String)

@Serializable
sealed interface Push {
    @Serializable
    @SerialName("saved")
    data class Saved(val saved: JsonElement) : Push

    @Serializable
    @SerialName("room")
    data class Room(val room: RoomView) : Push

    @Serializable
    @SerialName("gone")
    data class Gone(val code: String) : Push

    @Serializable
    @SerialName("log")
    data class Log(val line: String) : Push

    @Serializable
    @SerialName("removed")
    data class Removed(val by: String) : Push

    @Serializable
    @SerialName("launch")
    data class Launch(val code: String, val launch: String, val stage: String, val name: String) : Push

    @Serializable
    @SerialName("fetch")
    data class Fetch(val id: Int, val url: String, val body: String) : Push
}
