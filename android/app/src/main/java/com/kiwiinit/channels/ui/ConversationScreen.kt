package com.kiwiinit.channels.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.PlaceView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Filter
import com.kiwiinit.channels.model.Row as ConversationRow
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.asksIn
import com.kiwiinit.channels.model.elsewhere
import com.kiwiinit.channels.model.other
import com.kiwiinit.channels.model.row
import com.kiwiinit.channels.model.rows
import com.kiwiinit.channels.model.spotTitle
import com.kiwiinit.channels.model.taskLabel
import com.kiwiinit.channels.theme.Tone
import kotlinx.coroutines.launch

@Composable
fun ConversationScreen(
    model: AppModel,
    start: Spot,
    chosen: String?,
    consumeChosen: () -> Unit,
    back: () -> Unit,
    details: (Spot) -> Unit,
) {
    var spot by rememberSaveable(stateSaver = Spot.saver) { mutableStateOf(start) }
    var previous by remember { mutableStateOf<Spot?>(null) }
    var toLead by remember { mutableStateOf(true) }
    var replyTo by remember { mutableStateOf<MessageView?>(null) }
    var answering by remember { mutableStateOf<AskView?>(null) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val view = LocalView.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val resumed by lifecycle.currentStateAsState()

    fun switchTo(next: Spot) {
        if (next == spot) return
        view.buzz(Buzz.Tap)
        previous = spot
        replyTo = null
        answering = null
        toLead = !next.general
        spot = next
    }

    fun type() {
        try {
            focus.requestFocus()
            keyboard?.show()
        } catch (e: IllegalStateException) {
            // The field isn't laid out yet (the dock is still animating in); the person taps it instead.
        }
    }

    LaunchedEffect(chosen) {
        val key = chosen ?: return@LaunchedEffect
        consumeChosen()
        switchTo(Spot(spot.code, key))
    }
    LaunchedEffect(spot) {
        model.visit(spot)
        model.open(spot.code)
    }

    val room = model.shown(spot)
    if (room == null) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
            Header(model, null, spot, previous, back = back, details = {}, switchTo = ::switchTo)
            Centered("This channel is gone", "Its owner closed it, or this phone was removed from it.")
        }
        return
    }
    val lastSeq = room.placeView(spot.place)?.lastSeq
    LaunchedEffect(spot, lastSeq, resumed) {
        if (resumed.isAtLeast(Lifecycle.State.RESUMED)) model.markRead(spot)
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).navigationBarsPadding().imePadding()) {
        Header(model, room, spot, previous, back = back, details = { details(spot) }, switchTo = ::switchTo)
        Box(Modifier.weight(1f)) {
            AnimatedContent(
                targetState = spot,
                transitionSpec = {
                    val sign = if (toLead) 1 else -1
                    (slideInHorizontally(tween(300)) { it * sign } + fadeIn(tween(200))) togetherWith
                        (slideOutHorizontally(tween(300)) { -it * sign } + fadeOut(tween(200)))
                },
                label = "spot",
            ) { at ->
                val shown = model.shown(at)
                if (shown != null) {
                    val state = rememberLazyListState()
                    val follow = remember { Follow() }
                    val scope = rememberCoroutineScope()
                    Box(Modifier.fillMaxSize()) {
                        Conversation(
                            model = model,
                            room = shown,
                            spot = at,
                            state = state,
                            follow = follow,
                            elsewhere = if (at.general) shown.elsewhere() else emptyList(),
                            reply = { m ->
                                answering = null
                                replyTo = m
                                type()
                            },
                            answer = { ask ->
                                replyTo = null
                                answering = ask
                                type()
                            },
                        )
                        AnimatedVisibility(
                            visible = !follow.atBottom,
                            enter = scaleIn() + fadeIn(),
                            exit = scaleOut() + fadeOut(),
                            modifier = Modifier.align(Alignment.BottomEnd).padding(end = 14.dp, bottom = 8.dp),
                        ) {
                            BadgedBox(badge = { if (follow.unseen > 0) Badge { Text("${follow.unseen}") } }) {
                                SmallFloatingActionButton(
                                    onClick = { scope.launch { state.animateScrollToItem(0) } },
                                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                                ) {
                                    Icon(
                                        Icons.Filled.KeyboardArrowDown,
                                        contentDescription = if (follow.unseen > 0) "${follow.unseen} new, jump to the latest" else "Jump to the latest",
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        Dock(
            model = model,
            room = room,
            spot = spot,
            replyTo = replyTo,
            answering = answering,
            focus = focus,
            clearReply = { replyTo = null },
            clearAnswer = { answering = null },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Header(
    model: AppModel,
    room: RoomView?,
    spot: Spot,
    previous: Spot?,
    back: () -> Unit,
    details: () -> Unit,
    switchTo: (Spot) -> Unit,
) {
    val tone = Tone.current
    val view = LocalView.current
    var menu by remember { mutableStateOf(false) }
    val other = room?.other(spot)
    val elsewhere = model.rows(Filter.Unread).any { it.spot != spot && it.spot != other }
    Row(
        Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).statusBarsPadding().height(64.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box {
            Box(
                Modifier.size(48.dp)
                    .clip(CircleShape)
                    .combinedClickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = ripple(bounded = false),
                        onClick = back,
                        onLongClick = {
                            view.buzz(Buzz.Tap)
                            menu = true
                        },
                    )
                    .semantics { contentDescription = "Back. Touch and hold for your other conversations" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null)
                if (elsewhere) {
                    Dot(
                        MaterialTheme.colorScheme.primary,
                        10.dp,
                        Modifier.align(Alignment.TopEnd).offset(x = (-8).dp, y = 8.dp).border(2.dp, MaterialTheme.colorScheme.surface, CircleShape),
                    )
                }
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                BackMenu(model, spot, previous) {
                    menu = false
                    switchTo(it)
                }
            }
        }
        if (room != null) {
            val place = room.placeView(spot.place)
            Row(
                Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable {
                    view.buzz(Buzz.Tap)
                    details()
                }.padding(horizontal = 6.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val dm = place?.let { room.other(it) }
                if (dm != null) Face(dm, room.member(dm), 40.dp) else ChannelAvatar(room, 40.dp)
                Column(Modifier.weight(1f)) {
                    Text(room.spotTitle(place?.key ?: "main"), style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Status(room, place)
                }
            }
            if (other != null) Flip(model, room, other) { switchTo(other) }
        } else {
            Box(Modifier.weight(1f))
        }
    }
    HorizontalDivider(color = tone.line)
}

@Composable
private fun Status(room: RoomView, place: PlaceView?) {
    val tone = Tone.current
    val dmName = place?.let { room.other(it) }
    val dm: MemberView? = dmName?.let { room.member(it) }
    val busy = if (dm != null && dm.working) dm.doing.firstOrNull()?.let { "working on ${taskLabel(it)}" } ?: "working" else null
    val main = place?.kind == "main"
    val parts = listOfNotNull(
        if (place?.kind == "dm") (busy ?: (if (dm?.here == true) "here" else "away")) else null,
        if (room.connection == Connection.Connecting) "Connecting…" else null,
        if (room.connection == Connection.Reconnecting) "Reconnecting…" else null,
        if (main && room.working > 0) "${room.working} working" else null,
        if (main && room.asks.isNotEmpty()) "${room.asks.size} ${if (room.asks.size == 1) "needs" else "need"} you" else null,
    )
    if (parts.isEmpty()) return
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if ((main && room.working > 0) || busy != null) Dot(tone.doing, 6.dp)
        Text(
            parts.joinToString(" · "),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Medium,
            color = if (main && room.asks.isNotEmpty()) tone.decide else tone.ink3,
            maxLines = 1,
        )
    }
}

@Composable
private fun Flip(model: AppModel, room: RoomView, other: Spot, go: () -> Unit) {
    val tone = Tone.current
    val asks = room.asksIn(other.place).isNotEmpty()
    val fresh = model.unread(other)
    val lead = room.lead
    Box(
        Modifier.size(48.dp)
            .clip(CircleShape)
            .clickable(onClick = go)
            .semantics { contentDescription = if (other.general) "Open # general" else "Open your chat with ${room.spotTitle(other.place)}" },
        contentAlignment = Alignment.Center,
    ) {
        if (other.general) {
            ChannelAvatar(room, 34.dp)
        } else if (lead != null) {
            Face(lead, room.member(lead), 34.dp)
        }
        if (asks || fresh) {
            Dot(
                if (asks) tone.decide else MaterialTheme.colorScheme.primary,
                11.dp,
                Modifier.align(Alignment.TopEnd).offset(x = (-6).dp, y = 6.dp).border(2.dp, MaterialTheme.colorScheme.surface, CircleShape),
            )
        }
    }
}

@Composable
private fun BackMenu(model: AppModel, spot: Spot, previous: Spot?, pick: (Spot) -> Unit) {
    val used = mutableSetOf(spot)
    val tone = Tone.current

    @Composable
    fun item(row: ConversationRow, prefix: String? = null) {
        DropdownMenuItem(
            text = {
                Column(Modifier.widthIn(max = 260.dp)) {
                    Text(row.fullTitle, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
                    Text(
                        prefix?.let { "$it · ${row.line}" } ?: row.line,
                        style = MaterialTheme.typography.bodySmall,
                        color = tone.ink3,
                        maxLines = 1,
                    )
                }
            },
            leadingIcon = { RowAvatar(row, 32.dp) },
            onClick = { pick(row.spot) },
        )
    }

    @Composable
    fun section(title: String, rows: List<ConversationRow>, count: Int) {
        val picked = rows.filter { it.spot !in used }.take(count)
        if (picked.isEmpty()) return
        used += picked.map { it.spot }
        Text(title, style = MaterialTheme.typography.labelMedium, color = tone.ink3, modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 2.dp))
        for (row in picked) item(row)
    }

    val last = previous ?: model.visited.firstOrNull { it != spot }
    val lastRow = last?.let { model.row(it) }
    if (last != null && lastRow != null) {
        used += last
        item(lastRow, "Previous")
    }
    section("Needs you", model.rows(Filter.Needs), 3)
    section("Unread", model.rows(Filter.Unread), 3)
    section("Recent", model.rows(Filter.All), 6)
}
