package com.kiwiinit.channels.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Filter
import com.kiwiinit.channels.model.Row as ConversationRow
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.TaskCounts
import com.kiwiinit.channels.model.other
import com.kiwiinit.channels.model.rows
import com.kiwiinit.channels.model.section
import com.kiwiinit.channels.model.spotTitle
import com.kiwiinit.channels.theme.Tone
import kotlin.math.abs
import kotlinx.coroutines.launch
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import com.kiwiinit.channels.R
import com.kiwiinit.channels.model.Words

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationList(model: AppModel, open: (Spot) -> Unit, tasks: (String) -> Unit) {
    val tone = Tone.current
    var refreshing by remember { mutableStateOf(false) }
    val channels = model.channels
    val many = channels.size > 1
    LaunchedEffect(refreshing) {
        if (refreshing) {
            model.nudge()
            kotlinx.coroutines.delay(700)
            refreshing = false
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        BigTitle(stringResource(R.string.tab_chats)) { MarkAllRead(model) }
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refreshing = true }, modifier = Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 4.dp, bottom = 16.dp)) {
                model.unsaved?.let { why ->
                    item(key = "unsaved") {
                        Text(why, style = MaterialTheme.typography.bodyMedium, color = tone.alert, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                    }
                }
                if (channels.isEmpty()) item(key = "empty") { Empty(model) }
                for (room in channels) {
                    item(key = "head-${room.code}") { ChannelHeader(room) }
                    items(model.section(room, false), key = { it.id }) { row ->
                        SwipeRow(model, row, Modifier.animateItem(), open)
                    }
                    item(key = "tasks-${room.code}") { TasksRow(room) { tasks(room.code) } }
                }
                if (many) item(key = "end") { Spacer(Modifier.height(8.dp)) }
            }
        }
    }
}

@Composable
private fun ChannelHeader(room: RoomView) {
    val tone = Tone.current
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 16.dp, top = 18.dp, bottom = 4.dp).semantics { heading() }, verticalAlignment = Alignment.CenterVertically) {
        Text(room.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = tone.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (room.working > 0) Text(" · " + pluralStringResource(R.plurals.n_working, room.working, room.working), style = MaterialTheme.typography.titleSmall, color = tone.doing)
        if (room.connection == com.kiwiinit.channels.engine.Connection.Connecting) Text(" · " + stringResource(R.string.connecting_lower), style = MaterialTheme.typography.titleSmall, color = tone.ink3)
    }
}

@Composable
private fun TasksRow(room: RoomView, open: () -> Unit) {
    PlainRow(stringResource(R.string.tasks), TaskCounts.of(room).line(words()), open) { Disc(Icons.Filled.Checklist, 52.dp) }
}

@Composable
private fun PlainRow(title: String, line: String, open: () -> Unit, icon: @Composable () -> Unit) {
    val tone = Tone.current
    Row(
        Modifier.fillMaxWidth().clickable(onClick = open).heightIn(min = 76.dp).padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        icon()
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium, maxLines = 1)
            if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodyMedium, color = tone.ink3, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
    }
}

@Composable
private fun MarkAllRead(model: AppModel) {
    if (model.rows(Filter.Unread).isEmpty()) return
    IconButton(onClick = { model.markAllRead() }) { Icon(Icons.Filled.MarkEmailRead, contentDescription = stringResource(R.string.mark_all_read), tint = Tone.current.ink2) }
}

@Composable
private fun Empty(model: AppModel) {
    val waiting = model.waiting
    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (waiting > 0) stringResource(R.string.waiting_let_in) else stringResource(R.string.no_conversations), style = MaterialTheme.typography.titleMedium)
        Text(
            when {
                waiting > 0 -> pluralStringResource(R.plurals.n_asked_to_join, waiting, waiting)
                model.enrolled -> stringResource(R.string.enrolled_empty)
                else -> stringResource(R.string.linked_empty)
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Tone.current.ink3,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (!model.enrolled) {
            Text(
                stringResource(R.string.link_again),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 12.dp).clip(RoundedCornerShape(8.dp)).clickable { model.relinkAsked = true }.padding(8.dp),
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SwipeRow(model: AppModel, row: ConversationRow, modifier: Modifier, open: (Spot) -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    val shift = remember { Animatable(0f) }
    var menu by remember { mutableStateOf(false) }
    val reach = 96f
    val now by rememberUpdatedState(row)
    Box(modifier.fillMaxWidth()) {
        Row(Modifier.matchParentSize(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.fillMaxWidth().fillMaxHeight().background(if (shift.value > 0) MaterialTheme.colorScheme.primary else Color.Transparent),
                contentAlignment = Alignment.CenterStart,
            ) {
                if (shift.value > 0) {
                    Icon(
                        if (row.unread) Icons.Filled.MarkEmailRead else Icons.Filled.MarkEmailUnread,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.padding(start = 28.dp),
                    )
                }
            }
        }
        Box(
            Modifier.offset { IntOffset(shift.value.dp.roundToPx(), 0) }
                .background(MaterialTheme.colorScheme.surface)
                .pointerInput(row.id) {
                    var dragged = 0f
                    detectHorizontalDragGestures(
                        onDragStart = { dragged = shift.value },
                        onDragEnd = {
                            val at = dragged
                            if (at >= reach) {
                                view.buzz(Buzz.Tap)
                                if (now.unread) model.markRead(now.spot) else model.markUnread(now.spot)
                            }
                            scope.launch { shift.animateTo(0f, spring(dampingRatio = 0.75f, stiffness = 500f)) }
                        },
                        onDragCancel = { scope.launch { shift.animateTo(0f) } },
                    ) { change, amount ->
                        change.consume()
                        val next = (dragged + amount / density).coerceIn(0f, 160f)
                        if ((abs(dragged) < reach) != (abs(next) < reach)) view.buzz(Buzz.Tap)
                        dragged = next
                        scope.launch { shift.snapTo(next) }
                    }
                }
                .combinedClickable(
                    onClick = { open(row.spot) },
                    onLongClick = {
                        view.buzz(Buzz.Tap)
                        menu = true
                    },
                ),
        ) {
            ConversationRowView(row)
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                RowMenu(model, row, close = { menu = false }, open = open)
            }
        }
    }
}

@Composable
private fun RowMenu(model: AppModel, row: ConversationRow, close: () -> Unit, open: (Spot) -> Unit) {
    val ask = row.asks.firstOrNull { it.choices.isNotEmpty() }
    if (ask != null) {
        Text(
            stringResource(R.string.answer_who, row.room.display(ask.from)),
            style = MaterialTheme.typography.labelMedium,
            color = Tone.current.decide,
            modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 2.dp),
        )
        for (choice in ask.choices) {
            DropdownMenuItem(
                text = { Text(choice, maxLines = 2) },
                leadingIcon = { Icon(Icons.Filled.CheckCircle, contentDescription = null) },
                onClick = {
                    close()
                    model.later { model.answer(row.spot.code, ask.seq, choice) }
                },
            )
        }
        HorizontalDivider()
    }
    val other = row.room.other(row.spot)
    if (other != null) {
        DropdownMenuItem(
            text = { Text(if (other.general) stringResource(R.string.open_general) else stringResource(R.string.message_who, row.room.spotTitle(other.place))) },
            leadingIcon = { Icon(if (other.general) Icons.Filled.Tag else Icons.AutoMirrored.Outlined.Chat, contentDescription = null) },
            onClick = {
                close()
                open(other)
            },
        )
    }
    DropdownMenuItem(
        text = { Text(if (row.unread) stringResource(R.string.mark_read) else stringResource(R.string.mark_unread)) },
        leadingIcon = { Icon(if (row.unread) Icons.Filled.MarkEmailRead else Icons.Filled.MarkEmailUnread, contentDescription = null) },
        onClick = {
            close()
            if (row.unread) model.markRead(row.spot) else model.markUnread(row.spot)
        },
    )
}

@Composable
private fun ConversationRowView(row: ConversationRow) {
    val tone = Tone.current
    val strong = if (row.unread) FontWeight.Bold else FontWeight.Normal
    Row(
        Modifier.fillMaxWidth().heightIn(min = 76.dp).padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowAvatar(row, 52.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    buildAnnotatedString {
                        append(row.title)
                        row.qualifier?.let { withStyle(SpanStyle(color = tone.ink3, fontWeight = FontWeight.Normal)) { append(" · $it") } }
                    },
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = if (row.unread) FontWeight.Bold else FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                row.last?.let {
                    Text(
                        When.list(words(), it.millis),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = strong,
                        color = if (row.unread) MaterialTheme.colorScheme.onSurface else tone.ink3,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
            Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    preview(row),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = strong,
                    color = if (row.unread) MaterialTheme.colorScheme.onSurface else tone.ink3,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (row.unread) Dot(MaterialTheme.colorScheme.primary, 10.dp, Modifier.padding(start = 10.dp))
            }
        }
    }
}

@Composable
private fun preview(row: ConversationRow): androidx.compose.ui.text.AnnotatedString {
    val tone = Tone.current
    val w = words()
    return buildAnnotatedString { spans(row, tone, w) }
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.spans(row: ConversationRow, tone: com.kiwiinit.channels.theme.Tones, w: Words) {
    val need = row.need
    val line = row.line(w)
    val drafted = w(R.string.draft_line, "\u0000").substringBefore("\u0000")
    if (need != null) {
        val (before, after) = w(R.string.needs_you_line, "\u0000").split("\u0000", limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        withStyle(SpanStyle(color = tone.decide, fontWeight = FontWeight.SemiBold)) { append(before) }
        append(need)
        append(after)
        if (row.needs > 1) append(" · ${row.needs}")
    } else if (row.draft != null && line.startsWith(drafted)) {
        withStyle(SpanStyle(color = tone.alert)) { append(drafted) }
        append(line.removePrefix(drafted))
    } else {
        append(line)
    }
}

