package com.kiwiinit.channels.ui

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.BrokenImage
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.Chosen
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.QuoteView
import com.kiwiinit.channels.engine.ReactionView
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Pending
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.taskLabel
import com.kiwiinit.channels.theme.Radius
import com.kiwiinit.channels.theme.Tone
import com.kiwiinit.channels.theme.prism
import java.io.File
import java.io.IOException
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

sealed interface Line {
    val id: String

    data class Time(override val id: String, val at: Long) : Line

    data class Event(override val id: String, val message: MessageView) : Line

    data class Bubble(override val id: String, val message: MessageView, val first: Boolean, val last: Boolean) : Line

    data class Ask(override val id: String, val ask: AskView) : Line

    data class Review(override val id: String, val review: ReviewView) : Line

    data class Sending(override val id: String, val item: Pending) : Line

    companion object {
        fun build(messages: List<MessageView>, asks: List<AskView>, reviews: List<ReviewView>, pending: List<Pending>, sentAs: Map<Int, String>): List<Line> {
            val out = mutableListOf<Line>()
            var prev: MessageView? = null
            var lastAt: MessageView? = null
            val held: List<Pair<Double, Line>> = asks.map { it.at to Ask("a${it.seq}", it) } + reviews.map { it.at to Review("r${it.task}", it) }
            val waiting = ArrayDeque(held.sortedBy { it.first })
            val answers = messages.mapNotNull { m -> m.chosen?.let { "${it.by}|${it.choice}" } }.toSet()
            for (m in messages) {
                if (m.choices.isEmpty() && "${m.from}|${m.body}" in answers) continue
                while (waiting.isNotEmpty() && waiting.first().first < m.at) {
                    out += waiting.removeFirst().second
                    prev = null
                }
                val before = lastAt
                val gap = if (before == null) Double.POSITIVE_INFINITY else m.at - before.at
                val newDay = before == null || !When.sameDay(before.millis, m.millis)
                lastAt = m
                if (newDay || gap > 15 * 60_000) {
                    out += Time("t${m.seq}", m.millis)
                    prev = null
                }
                if (m.event) {
                    out += Event("e${m.seq}", m)
                    prev = null
                    continue
                }
                val first = prev == null || prev.from != m.from || m.quote != null
                if (!first) {
                    val previous = out.lastOrNull()
                    if (previous is Bubble) out[out.size - 1] = previous.copy(last = false)
                }
                out += Bubble(sentAs[m.seq]?.let { "p$it" } ?: "b${m.seq}", m, first, true)
                prev = m
            }
            out += waiting.map { it.second }
            val shown = messages.map { it.seq }.toSet()
            out += pending.filter { item -> item.seq?.let { it !in shown } ?: true }.map { Sending("p${it.id}", it) }
            return out
        }
    }
}

@Stable
class Follow {
    var atBottom by mutableStateOf(true)
    var unseen by mutableIntStateOf(0)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Conversation(
    model: AppModel,
    room: RoomView,
    spot: Spot,
    state: LazyListState,
    follow: Follow,
    elsewhere: List<AskView>,
    reviews: List<ReviewView>,
    reply: (MessageView) -> Unit,
    answer: (AskView) -> Unit,
    sendBack: (ReviewView) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val pending = model.pending[spot.id] ?: emptyList()
    val sent = model.sentAs.toMap()
    val lines = remember(room.messages, elsewhere, reviews, pending, sent) { Line.build(room.messages, elsewhere, reviews, pending, sent) }
    val shown = remember(lines) { lines.asReversed() }
    val solo = room.placeView(room.place)?.let { it.kind == "dm" && it.withMe } ?: false
    var reveal by remember { mutableFloatStateOf(0f) }
    val atBottom by remember(state) { derivedStateOf { state.firstVisibleItemIndex == 0 && state.firstVisibleItemScrollOffset < 160 } }
    LaunchedEffect(atBottom) {
        follow.atBottom = atBottom
        if (atBottom) follow.unseen = 0
    }
    val newest = room.messages.lastOrNull()
    var lastSeq by remember { mutableStateOf(newest?.seq) }
    LaunchedEffect(newest?.seq) {
        val before = lastSeq
        lastSeq = newest?.seq
        if (before == null || newest == null || newest.seq == before) return@LaunchedEffect
        if (follow.atBottom || newest.mine) {
            state.animateScrollToItem(0)
        } else {
            follow.unseen += room.messages.count { it.seq > before && !it.mine && !it.event }
        }
    }
    val typing = WindowInsets.isImeVisible
    LaunchedEffect(typing) {
        if (!typing) return@LaunchedEffect
        delay(250)
        state.animateScrollToItem(0)
    }
    var pendingCount by remember { mutableIntStateOf(pending.size) }
    LaunchedEffect(pending.size) {
        if (pending.size > pendingCount) state.animateScrollToItem(0)
        pendingCount = pending.size
    }
    val jump: (Int) -> Unit = { seq ->
        val at = shown.indexOfFirst { it is Line.Bubble && it.message.seq == seq }
        if (at >= 0) {
            scope.launch {
                state.animateScrollToItem(at)
                val item = state.layoutInfo.visibleItemsInfo.firstOrNull { it.index == at } ?: return@launch
                val viewport = state.layoutInfo.viewportEndOffset - state.layoutInfo.viewportStartOffset
                state.animateScrollBy(-(viewport - item.size) / 2f)
            }
        }
    }
    val revealEnd: () -> Unit = {
        scope.launch { animate(reveal, 0f, animationSpec = spring(dampingRatio = 0.8f, stiffness = 500f)) { v, _ -> reveal = v } }
    }
    LazyColumn(
        state = state,
        reverseLayout = true,
        modifier = modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 6.dp),
    ) {
        items(shown, key = { it.id }, contentType = { it::class.simpleName ?: "line" }) { line ->
            Box(Modifier.animateItem()) {
                when (line) {
                    is Line.Time -> TimeLine(line.at)
                    is Line.Event -> EventLine(room, line.message)
                    is Line.Ask -> AskLine(model, room, line.ask) { answer(line.ask) }
                    is Line.Review -> ReviewLine(model, room, line.review) { sendBack(line.review) }
                    is Line.Sending -> PendingBubble(model, line.item, spot)
                    is Line.Bubble -> BubbleRow(
                        model = model,
                        room = room,
                        message = line.message,
                        first = line.first,
                        last = line.last,
                        solo = solo,
                        reveal = { reveal },
                        revealTo = { reveal = it },
                        revealEnd = revealEnd,
                        reply = reply,
                        jump = jump,
                        answer = { seq -> room.asks.firstOrNull { it.seq == seq }?.let(answer) },
                    )
                }
            }
        }
        item(key = "intro", contentType = "intro") {
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                if (room.whole || (room.messages.isEmpty() && room.connection == Connection.Live)) Intro(room)
                if (!room.whole && room.messages.isNotEmpty()) {
                    Text(
                        "Earlier messages aren't on this phone",
                        style = MaterialTheme.typography.labelMedium,
                        color = Tone.current.ink3,
                        modifier = Modifier.padding(vertical = 14.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun TimeLine(at: Long) {
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(When.dayWord(at)) }
            append(" ${When.clock(at)}")
        },
        style = MaterialTheme.typography.labelMedium,
        color = Tone.current.ink3,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 6.dp),
    )
}

@Composable
private fun EventLine(room: RoomView, m: MessageView) {
    Text(
        "${room.display(m.from)} ${m.body}",
        style = MaterialTheme.typography.labelMedium,
        color = Tone.current.ink3,
        textAlign = TextAlign.Center,
        maxLines = 2,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 4.dp),
    )
}

@Composable
fun Intro(room: RoomView) {
    val lead = if (room.place == "main") null else room.lead
    val tone = Tone.current
    val lines: List<String> = if (lead == null) {
        val names = room.members.filter { it.name != room.me }.map { it.display }
        listOf("You, ${names.joinToString(", ")}", if (room.messages.isEmpty()) "No messages yet" else "The start of #general")
    } else {
        val member = room.member(lead)
        val now = if (member?.working == true) member.doing.firstOrNull()?.let { "Working on ${taskLabel(it)}" } ?: "Working" else null
        listOfNotNull("Lead of ${room.title}", now ?: if (room.messages.isEmpty()) "Everyone in the channel can read this" else null)
    }
    Column(
        Modifier.fillMaxWidth().padding(start = 32.dp, end = 32.dp, top = if (room.messages.isEmpty()) 72.dp else 28.dp, bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (lead != null) Face(lead, room.member(lead), 72.dp) else ChannelAvatar(room, 72.dp)
        Text(
            if (lead != null) room.display(lead) else room.title,
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
        )
        for (line in lines) Text(line, style = MaterialTheme.typography.bodySmall, color = tone.ink3, textAlign = TextAlign.Center)
    }
}

fun bubbleShape(mine: Boolean, first: Boolean, last: Boolean): RoundedCornerShape {
    val big = Radius.bubble
    val top = if (first) big else Radius.joined
    val bottom = if (last) big else Radius.joined
    return if (mine) {
        RoundedCornerShape(topStart = big, topEnd = top, bottomEnd = bottom, bottomStart = big)
    } else {
        RoundedCornerShape(topStart = top, topEnd = big, bottomEnd = big, bottomStart = bottom)
    }
}

@Composable
private fun BubbleRow(
    model: AppModel,
    room: RoomView,
    message: MessageView,
    first: Boolean,
    last: Boolean,
    solo: Boolean,
    reveal: () -> Float,
    revealTo: (Float) -> Unit,
    revealEnd: () -> Unit,
    reply: (MessageView) -> Unit,
    jump: (Int) -> Unit,
    answer: (Int) -> Unit,
) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var pull by remember { mutableFloatStateOf(0f) }
    var armed by remember { mutableStateOf(false) }
    val onReply by rememberUpdatedState { reply(message) }
    val onReveal by rememberUpdatedState(revealTo)
    val onRevealEnd by rememberUpdatedState(revealEnd)
    val widest = (LocalConfiguration.current.screenWidthDp * 0.78f).dp
    Box(
        Modifier.fillMaxWidth()
            .padding(top = if (first) 8.dp else 2.dp)
            .pointerInput(message.seq) {
                var total = 0f
                detectHorizontalDragGestures(
                    onDragStart = { total = 0f },
                    onDragEnd = {
                        if (armed) onReply()
                        armed = false
                        scope.launch { animate(pull, 0f, animationSpec = spring(dampingRatio = 0.7f, stiffness = 500f)) { v, _ -> pull = v } }
                        onRevealEnd()
                    },
                    onDragCancel = {
                        armed = false
                        pull = 0f
                        onRevealEnd()
                    },
                ) { change, amount ->
                    change.consume()
                    total += amount / density
                    if (total > 0) {
                        pull = min(84f, total * 0.6f)
                        val now = pull >= REPLY_AT
                        if (now != armed) {
                            armed = now
                            if (now) view.buzz(Buzz.Tap)
                        }
                    } else {
                        onReveal(min(REVEAL_MAX, -total * 0.7f))
                    }
                }
            },
    ) {
        Box(
            Modifier.align(Alignment.CenterStart)
                .offset { IntOffset((-36 + pull * 0.6f).dp.roundToPx(), 0) }
                .graphicsLayer { alpha = min(1f, pull / REPLY_AT) }
                .size(30.dp)
                .clip(CircleShape)
                .background(tone.wash2),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Reply,
                contentDescription = null,
                tint = if (armed) MaterialTheme.colorScheme.primary else tone.ink3,
                modifier = Modifier.size(16.dp),
            )
        }
        Row(
            Modifier.fillMaxWidth().offset { IntOffset((pull - reveal()).dp.roundToPx(), 0) },
            horizontalArrangement = if (message.mine) Arrangement.End else Arrangement.Start,
            verticalAlignment = Alignment.Bottom,
        ) {
            if (!message.mine && !solo) {
                Box(Modifier.size(30.dp)) {
                    if (last) Face(message.from, room.member(message.from), 30.dp)
                }
                Spacer(Modifier.width(8.dp))
            }
            Column(Modifier.widthIn(max = widest), horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start) {
                if (first && !message.mine && !solo) {
                    Text(
                        room.display(message.from),
                        style = MaterialTheme.typography.labelMedium,
                        color = tone.ink3,
                        modifier = Modifier.padding(start = 12.dp, bottom = 3.dp),
                    )
                }
                message.quote?.let { QuoteBubble(it, room) { jump(it.seq) } }
                if (message.choices.isEmpty()) {
                    BubbleBody(model, room, message, first, last) { reply(message) }
                } else {
                    PollCard(model, room, Poll.of(message)) {
                        if (message.waiting) answer(message.seq) else reply(message)
                    }
                }
            }
        }
        Text(
            When.clock(message.millis),
            style = MaterialTheme.typography.labelSmall,
            color = tone.ink3,
            maxLines = 1,
            modifier = Modifier.align(Alignment.CenterEnd)
                .offset { IntOffset((REVEAL_MAX - reveal() + 4).dp.roundToPx(), 0) }
                .graphicsLayer { alpha = reveal() / REVEAL_MAX },
        )
    }
}

private const val REPLY_AT = 56f
private const val REVEAL_MAX = 62f

private val tapbacks = listOf("❤️", "👍", "👎", "😂", "‼️", "❓")

@Composable
private fun BubbleBody(model: AppModel, room: RoomView, message: MessageView, first: Boolean, last: Boolean, reply: () -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var menu by remember { mutableStateOf(false) }
    val onHold by rememberUpdatedState {
        view.buzz(Buzz.Tap)
        menu = true
    }
    val fill = if (message.mine) tone.mine else tone.them
    val ink = if (message.mine) tone.onMine else tone.onThem
    val onlyPictures = message.images > 0 && message.body.isBlank()
    Box {
        Column(
            Modifier.padding(top = if (message.reactions.isEmpty()) 0.dp else 20.dp),
            horizontalAlignment = if (message.mine) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            for (i in 0 until message.images) Picture(model, room.code, message.seq, i)
            if (!onlyPictures) {
                Box(
                    Modifier.clip(bubbleShape(message.mine, first, last))
                        .background(fill)
                        .held { onHold() }
                        .semantics {
                            onLongClick {
                                onHold()
                                true
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                ) {
                    Markdown(message.shown, Inks(ink, if (message.mine) ink else MaterialTheme.colorScheme.primary, ink.copy(alpha = 0.12f), message.mine), selectable = false)
                }
            }
        }
        if (message.reactions.isNotEmpty()) {
            Badges(
                message.reactions,
                Modifier.align(if (message.mine) Alignment.TopStart else Alignment.TopEnd).offset(x = if (message.mine) (-12).dp else 12.dp, y = 2.dp),
            )
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            Row(Modifier.padding(horizontal = 8.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (emoji in tapbacks) {
                    val current = emoji == message.myReaction
                    Box(
                        Modifier.size(40.dp)
                            .clip(CircleShape)
                            .background(if (current) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                            .clickable {
                                menu = false
                                view.buzz(Buzz.Tap)
                                model.later { model.react(room.code, message.seq, if (current) null else emoji) }
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(emoji, fontSize = 22.sp)
                    }
                }
            }
            HorizontalDivider()
            DropdownMenuItem(
                text = { Text("Reply") },
                leadingIcon = { Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null) },
                onClick = {
                    menu = false
                    reply()
                },
            )
            DropdownMenuItem(
                text = { Text("Copy") },
                leadingIcon = { Icon(Icons.Filled.ContentCopy, contentDescription = null) },
                onClick = {
                    menu = false
                    scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Message", message.body))) }
                },
            )
        }
    }
}

@Composable
private fun Badges(reactions: List<ReactionView>, modifier: Modifier = Modifier) {
    val tone = Tone.current
    val ring = MaterialTheme.colorScheme.surface
    Row(
        modifier.clearAndSetSemantics { contentDescription = reactions.joinToString("; ") { "${it.emoji} ${it.who.joinToString(", ")}" } },
        horizontalArrangement = Arrangement.spacedBy((-8).dp),
    ) {
        for (r in reactions.take(3)) {
            Box(
                Modifier.size(28.dp).clip(CircleShape).background(ring).padding(2.dp).clip(CircleShape).background(if (r.mine) tone.mine else tone.them),
                contentAlignment = Alignment.Center,
            ) {
                Text(r.emoji, fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun QuoteBubble(quote: QuoteView, room: RoomView, tap: () -> Unit) {
    val tone = Tone.current
    Column(
        Modifier.padding(bottom = 3.dp)
            .widthIn(max = 260.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(tone.wash2)
            .clickable(onClick = tap)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Text(room.display(quote.from), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = tone.ink3)
        Text(quote.words, style = MaterialTheme.typography.bodySmall, color = tone.ink3, maxLines = 2)
    }
}

data class Poll(val seq: Int, val body: String, val choices: List<String>, val chosen: Chosen?, val waiting: Boolean) {
    companion object {
        fun of(message: MessageView): Poll = Poll(message.seq, message.shown, message.choices, message.chosen, message.waiting)

        fun of(ask: AskView): Poll = Poll(ask.seq, ask.shown, ask.choices, null, true)
    }
}

@Composable
fun PollCard(model: AppModel, room: RoomView, poll: Poll, other: () -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var sending by remember(poll.seq) { mutableStateOf<String?>(null) }
    var failed by remember(poll.seq) { mutableStateOf(false) }
    val open = poll.waiting && poll.chosen == null
    val picked = poll.chosen?.choice ?: sending
    Column(
        Modifier.widthIn(max = 300.dp)
            .clip(RoundedCornerShape(Radius.bubble))
            .background(tone.them)
            .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 8.dp),
    ) {
        Text(
            if (open) "Question for you" else if (poll.chosen == null) "Question" else "Decided",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (open) tone.decide else tone.ink3,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        Markdown(poll.body, Inks(tone.onThem, MaterialTheme.colorScheme.primary, tone.wash2, false), Modifier.padding(bottom = 10.dp))
        HorizontalDivider(color = tone.line)
        for (choice in poll.choices) {
            val chosen = picked == choice
            Column(
                Modifier.fillMaxWidth().semantics { selected = chosen }.clickable(enabled = open && sending == null) {
                    sending = choice
                    failed = false
                    view.buzz(Buzz.Tap)
                    scope.launch {
                        try {
                            model.answer(room.code, poll.seq, choice)
                            view.buzz(Buzz.Done)
                        } catch (e: EngineException) {
                            sending = null
                            failed = true
                            view.buzz(Buzz.Fail)
                        }
                    }
                },
            ) {
                Row(
                    Modifier.fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .then(if (chosen) Modifier.prism(12.dp, tone.dark, 0.5f) else Modifier)
                        .padding(horizontal = if (chosen) 8.dp else 0.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Box(
                        Modifier.size(22.dp)
                            .clip(CircleShape)
                            .background(if (chosen) MaterialTheme.colorScheme.primary else Color.Transparent)
                            .border(1.5.dp, if (chosen) MaterialTheme.colorScheme.primary else tone.ink3, CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (chosen) Icon(Icons.Filled.Check, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(14.dp))
                    }
                    Text(
                        choice,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Medium,
                        color = if (picked == null || chosen) tone.onThem else tone.ink3,
                        modifier = Modifier.weight(1f),
                    )
                    if (sending == choice && poll.chosen == null) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                }
                HorizontalDivider(color = tone.line, modifier = Modifier.padding(start = 32.dp))
            }
        }
        if (open) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = other),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp).padding(start = 2.dp))
                Text("Something else…", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary)
            }
        }
        val chosenBy = poll.chosen
        if (chosenBy != null) {
            Text(
                "${if (chosenBy.by == room.me) "You" else room.display(chosenBy.by)} chose",
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.padding(top = 4.dp),
            )
        } else if (failed) {
            Text("Couldn't send · Try again", style = MaterialTheme.typography.labelMedium, color = tone.alert, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun AskLine(model: AppModel, room: RoomView, ask: AskView, other: () -> Unit) {
    val origin = when {
        ask.task != null -> "in ${taskLabel(ask.task)}"
        ask.place?.startsWith("dm:") == true -> "in a direct thread"
        else -> ""
    }
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.Bottom) {
        Face(ask.from, room.member(ask.from), 30.dp)
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                listOf(room.display(ask.from), origin).filter { it.isNotEmpty() }.joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = Tone.current.ink3,
                modifier = Modifier.padding(start = 12.dp, bottom = 3.dp),
            )
            PollCard(model, room, Poll.of(ask), other)
        }
    }
}

@Composable
private fun ReviewLine(model: AppModel, room: RoomView, review: ReviewView, back: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.Bottom) {
        val by = review.by
        if (by != null) Face(by, room.member(by), 30.dp) else Spacer(Modifier.size(30.dp))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(
                listOfNotNull(by?.let { room.display(it) }, "in ${taskLabel(review.task)}").joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = Tone.current.ink3,
                modifier = Modifier.padding(start = 12.dp, bottom = 3.dp),
            )
            ReviewCard(model, room, review, back)
        }
    }
}

@Composable
private fun ReviewCard(model: AppModel, room: RoomView, review: ReviewView, back: () -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var approving by remember(review.task) { mutableStateOf(false) }
    var failed by remember(review.task) { mutableStateOf(false) }
    Column(
        Modifier.widthIn(max = 300.dp)
            .clip(RoundedCornerShape(Radius.bubble))
            .background(tone.them)
            .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 8.dp),
    ) {
        Text(
            "Ready for your review",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = tone.decide,
            modifier = Modifier.padding(bottom = 4.dp),
        )
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = tone.ink3)) { append(taskLabel(review.task)) }
                append(" ${review.title}")
            },
            style = MaterialTheme.typography.bodyLarge,
            color = tone.onThem,
            modifier = Modifier.padding(bottom = 10.dp),
        )
        HorizontalDivider(color = tone.line)
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = !approving) {
                approving = true
                failed = false
                view.buzz(Buzz.Tap)
                scope.launch {
                    try {
                        model.approve(room.code, review.task)
                        view.buzz(Buzz.Done)
                    } catch (e: EngineException) {
                        failed = true
                        view.buzz(Buzz.Fail)
                    }
                    approving = false
                }
            },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = tone.onThem, modifier = Modifier.size(20.dp))
            Text("Approve", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = tone.onThem, modifier = Modifier.weight(1f))
            if (approving) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
        }
        HorizontalDivider(color = tone.line, modifier = Modifier.padding(start = 30.dp))
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = !approving, onClick = back),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            Text("Send back…", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary)
        }
        if (failed) {
            Text("Couldn't send · Try again", style = MaterialTheme.typography.labelMedium, color = tone.alert, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
private fun PendingBubble(model: AppModel, item: Pending, spot: Spot) {
    val tone = Tone.current
    var menu by remember { mutableStateOf(false) }
    val widest = (LocalConfiguration.current.screenWidthDp * 0.78f).dp
    Row(
        Modifier.fillMaxWidth().padding(top = 2.dp),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (item.failed) {
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Filled.ErrorOutline, contentDescription = "Not delivered", tint = tone.alert)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(
                        text = { Text("Try again") },
                        leadingIcon = { Icon(Icons.Filled.Refresh, contentDescription = null) },
                        onClick = {
                            menu = false
                            model.retry(item, spot)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("Delete") },
                        leadingIcon = { Icon(Icons.Filled.Delete, contentDescription = null) },
                        onClick = {
                            menu = false
                            model.drop(item, spot)
                        },
                    )
                }
            }
        }
        Column(Modifier.widthIn(max = widest), horizontalAlignment = Alignment.End) {
            Box(
                Modifier.alpha(if (item.seq == null && !item.failed) 0.85f else 1f)
                    .clip(bubbleShape(mine = true, first = true, last = true))
                    .background(tone.mine)
                    .padding(horizontal = 14.dp, vertical = 9.dp),
            ) {
                Markdown(item.body, Inks(tone.onMine, tone.onMine, tone.onMine.copy(alpha = 0.12f), true))
            }
            if (item.failed) {
                Text("Not delivered", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, color = tone.alert, modifier = Modifier.padding(top = 3.dp))
            }
        }
    }
}

@Composable
private fun Picture(model: AppModel, code: String, seq: Int, index: Int) {
    val tone = Tone.current
    val key = "$code/$seq/$index"
    var image by remember(key) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(key) { mutableStateOf(false) }
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(key) {
        val got = model.image(code, seq, index)
        if (got != null) image = got else failed = true
    }
    Box(Modifier.clip(RoundedCornerShape(18.dp))) {
        val got = image
        if (got != null) {
            Image(
                got,
                contentDescription = "Picture",
                contentScale = ContentScale.Fit,
                modifier = Modifier.widthIn(max = 240.dp).heightIn(max = 320.dp).clickable { shown = true },
            )
        } else {
            Box(Modifier.size(200.dp, 150.dp).background(tone.wash2), contentAlignment = Alignment.Center) {
                if (failed) {
                    Icon(Icons.Filled.BrokenImage, contentDescription = "Picture unavailable", tint = tone.ink3)
                } else {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                }
            }
        }
    }
    val big = image
    if (shown && big != null) Viewer(big) { shown = false }
}

@Composable
fun Viewer(image: ImageBitmap, close: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var zoom by remember { mutableFloatStateOf(1f) }
    var shift by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val fade = if (zoom > 1f) 1f else max(0.3f, 1f - abs(shift.y) / 1200f)
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = fade))) {
            Image(
                image,
                contentDescription = "Picture",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize()
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onTap = { if (zoom <= 1f) close() },
                            onDoubleTap = {
                                val target = if (zoom > 1f) 1f else 2.5f
                                shift = Offset.Zero
                                scope.launch { animate(zoom, target) { v, _ -> zoom = v } }
                            },
                        )
                    }
                    .pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            do {
                                val event = awaitPointerEvent()
                                zoom = (zoom * event.calculateZoom()).coerceIn(1f, 6f)
                                shift += event.calculatePan()
                                if (event.changes.size > 1 || shift.getDistance() > viewConfiguration.touchSlop) {
                                    event.changes.forEach { if (it.positionChanged()) it.consume() }
                                }
                            } while (event.changes.any { it.pressed })
                            if (zoom <= 1f) {
                                if (abs(shift.y) > 360f) {
                                    close()
                                } else {
                                    val from = shift
                                    scope.launch { animate(0f, 1f) { t, _ -> shift = from * (1f - t) } }
                                }
                            }
                        }
                    }
                    .graphicsLayer {
                        scaleX = zoom
                        scaleY = zoom
                        translationX = if (zoom > 1f) shift.x else 0f
                        translationY = shift.y
                    },
            )
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp)) {
                IconButton(onClick = close) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.White) }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { share(context, image) }) { Icon(Icons.Filled.Share, contentDescription = "Share", tint = Color.White) }
            }
        }
    }
}

private fun share(context: Context, image: ImageBitmap) {
    try {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val file = File(dir, "picture.jpg")
        file.outputStream().use { image.asAndroidBitmap().compress(Bitmap.CompressFormat.JPEG, 92, it) }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).setType("image/jpeg").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, null))
    } catch (e: IOException) {
        // The cache refused the copy: sharing does nothing and the picture stays on screen.
    }
}
