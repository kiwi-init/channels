package com.kiwiinit.channels.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MarkEmailRead
import androidx.compose.material.icons.filled.MarkEmailUnread
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Filter
import com.kiwiinit.channels.model.Row as ConversationRow
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.oneLine
import com.kiwiinit.channels.model.other
import com.kiwiinit.channels.model.rows
import com.kiwiinit.channels.model.spotTitle
import com.kiwiinit.channels.model.waiting
import com.kiwiinit.channels.theme.Tone
import kotlin.math.abs
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationList(model: AppModel, open: (Spot) -> Unit, settings: () -> Unit) {
    val tone = Tone.current
    var filter by rememberSaveable { mutableStateOf(Filter.All) }
    var search by rememberSaveable { mutableStateOf("") }
    var searching by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val query = search.trim().lowercase()
    val finding = searching || query.isNotEmpty()

    val all = model.rows(if (finding) Filter.All else filter)
    val pinnedIds = model.pinned.toList()
    val rows = when {
        query.isNotEmpty() -> all.filter { it.fullTitle.lowercase().contains(query) || it.line.lowercase().contains(query) }
        finding || filter != Filter.All -> all
        else -> pinnedIds.mapNotNull { id -> all.firstOrNull { it.id == id } } + all.filter { it.id !in pinnedIds }
    }
    val hits: List<Pair<ConversationRow, MessageView>> = if (query.length < 2) {
        emptyList()
    } else {
        model.rows(Filter.All).flatMap { row ->
            (model.shown(row.spot)?.messages ?: emptyList()).filter { !it.event && (it.plain.lowercase().contains(query) || it.body.lowercase().contains(query)) }.takeLast(3).map { row to it }
        }.sortedByDescending { it.second.at }.take(20)
    }

    BackHandler(enabled = finding) {
        search = ""
        searching = false
        focusManager.clearFocus()
    }
    LaunchedEffect(refreshing) {
        if (refreshing) {
            model.nudge()
            kotlinx.coroutines.delay(700)
            refreshing = false
        }
    }

    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().statusBarsPadding().padding(top = 8.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.weight(1f)
                        .height(52.dp)
                        .clip(RoundedCornerShape(26.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                        .padding(start = 4.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = {
                        if (finding) {
                            search = ""
                            searching = false
                            focusManager.clearFocus()
                        } else {
                            focus.requestFocus()
                        }
                    }) {
                        Icon(
                            if (finding) Icons.AutoMirrored.Filled.ArrowBack else Icons.Filled.Search,
                            contentDescription = if (finding) "End search" else "Search",
                            tint = tone.ink2,
                        )
                    }
                    BasicTextField(
                        value = search,
                        onValueChange = { search = it },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
                        modifier = Modifier.weight(1f).focusRequester(focus).onFocusChanged { searching = it.isFocused || search.isNotEmpty() },
                        decorationBox = { inner ->
                            Box(contentAlignment = Alignment.CenterStart) {
                                if (search.isEmpty()) Text("Search conversations", style = MaterialTheme.typography.bodyLarge, color = tone.ink3)
                                inner()
                            }
                        },
                    )
                    if (search.isNotEmpty()) {
                        IconButton(onClick = { search = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear", tint = tone.ink2) }
                    }
                }
                Spacer(Modifier.width(8.dp))
                Account(model, settings)
            }
            if (!finding) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(top = 10.dp),
                ) {
                    val alarm: @Composable () -> Unit = { Dot(tone.decide, 8.dp) }
                    items(Filter.entries.toList(), key = { it.name }) { f ->
                        val count = when (f) {
                            Filter.All -> 0
                            Filter.Needs -> model.waiting
                            Filter.Unread -> model.rows(Filter.Unread).size
                        }
                        FilterChip(
                            selected = filter == f,
                            onClick = { filter = f },
                            label = { Text(if (count > 0) "${f.title} · $count" else f.title) },
                            leadingIcon = if (f == Filter.Needs && count > 0 && filter != f) alarm else null,
                        )
                    }
                }
            }
            if (model.channels.any { it.connection == com.kiwiinit.channels.engine.Connection.Connecting }) {
                Text(
                    "Connecting…",
                    style = MaterialTheme.typography.labelMedium,
                    color = tone.ink3,
                    modifier = Modifier.padding(start = 20.dp, top = 6.dp),
                )
            }
        }
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = { refreshing = true }, modifier = Modifier.weight(1f).fillMaxWidth()) {
            val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
            LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = PaddingValues(top = 6.dp, bottom = 24.dp + bottom)) {
                model.unsaved?.let { why ->
                    item(key = "unsaved") {
                        Text(why, style = MaterialTheme.typography.bodyMedium, color = tone.alert, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
                    }
                }
                if (model.channels.isEmpty()) {
                    item(key = "empty") { Empty(model) }
                } else if (rows.isEmpty() && hits.isEmpty()) {
                    item(key = "none") {
                        Text(
                            if (finding) "No results" else when (filter) {
                                Filter.All -> "No conversations"
                                Filter.Needs -> "Nothing needs you"
                                Filter.Unread -> "No unread messages"
                            },
                            style = MaterialTheme.typography.titleMedium,
                            color = tone.ink3,
                            modifier = Modifier.fillMaxWidth().padding(top = 80.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
                items(rows, key = { it.id }) { row ->
                    SwipeRow(model, row, Modifier.animateItem(), open)
                }
                if (hits.isNotEmpty()) {
                    item(key = "messages") {
                        Text(
                            "Messages",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(start = 16.dp, top = 18.dp, bottom = 4.dp),
                        )
                    }
                    items(hits, key = { "hit-${it.first.id}-${it.second.seq}" }) { (row, message) ->
                        Hit(row, message, query) { open(row.spot) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Account(model: AppModel, settings: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val unread = model.rows(Filter.Unread).isNotEmpty()
    Box {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(22.dp)).clickable { menu = true }, contentAlignment = Alignment.Center) {
            Face(model.person.ifEmpty { "?" }, null, 38.dp)
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(
                text = { Text(if (model.person.isEmpty()) "Settings" else "Settings · ${model.person}") },
                leadingIcon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                onClick = {
                    menu = false
                    settings()
                },
            )
            if (unread) {
                DropdownMenuItem(
                    text = { Text("Mark all as read") },
                    leadingIcon = { Icon(Icons.Filled.MarkEmailRead, contentDescription = null) },
                    onClick = {
                        menu = false
                        model.markAllRead()
                    },
                )
            }
        }
    }
}

@Composable
private fun Empty(model: AppModel) {
    val waiting = model.waiting
    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (waiting > 0) "Waiting to be let in" else "No conversations", style = MaterialTheme.typography.titleMedium)
        Text(
            when {
                waiting > 0 -> "Asked to join ${if (waiting == 1) "1 channel" else "$waiting channels"} as you. Channels you own let this phone in while Channels is open on your computer."
                model.enrolled -> "This phone joins the channels your computer had when it approved it."
                else -> "Link your Mac again to bring your channels."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = Tone.current.ink3,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (!model.enrolled) {
            Text(
                "Link again",
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
    val pinned = model.isPinned(row.spot)
    val reach = 96f
    Box(modifier.fillMaxWidth()) {
        Row(Modifier.matchParentSize(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.weight(1f).fillMaxHeight().background(if (shift.value > 0) MaterialTheme.colorScheme.primary else Color.Transparent),
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
            Box(
                Modifier.weight(1f).fillMaxHeight().background(if (shift.value < 0) tone.decide else Color.Transparent),
                contentAlignment = Alignment.CenterEnd,
            ) {
                if (shift.value < 0) {
                    Icon(if (pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, contentDescription = null, tint = Color.White, modifier = Modifier.padding(end = 28.dp))
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
                            if (abs(at) >= reach) {
                                view.buzz(Buzz.Tap)
                                if (at > 0) {
                                    if (row.unread) model.markRead(row.spot) else model.markUnread(row.spot)
                                } else {
                                    model.togglePin(row.spot)
                                }
                            }
                            scope.launch { shift.animateTo(0f, spring(dampingRatio = 0.75f, stiffness = 500f)) }
                        },
                        onDragCancel = { scope.launch { shift.animateTo(0f) } },
                    ) { change, amount ->
                        change.consume()
                        val next = (dragged + amount / density).coerceIn(-160f, 160f)
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
            ConversationRowView(row, pinned)
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
            "Answer ${row.room.display(ask.from)}",
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
            text = { Text(if (other.general) "Open # general" else "Message ${row.room.spotTitle(other.place)}") },
            leadingIcon = { Icon(if (other.general) Icons.Filled.Tag else Icons.AutoMirrored.Outlined.Chat, contentDescription = null) },
            onClick = {
                close()
                open(other)
            },
        )
    }
    DropdownMenuItem(
        text = { Text(if (model.isPinned(row.spot)) "Unpin" else "Pin") },
        leadingIcon = { Icon(if (model.isPinned(row.spot)) Icons.Outlined.PushPin else Icons.Filled.PushPin, contentDescription = null) },
        onClick = {
            close()
            model.togglePin(row.spot)
        },
    )
    DropdownMenuItem(
        text = { Text(if (row.unread) "Mark as read" else "Mark as unread") },
        leadingIcon = { Icon(if (row.unread) Icons.Filled.MarkEmailRead else Icons.Filled.MarkEmailUnread, contentDescription = null) },
        onClick = {
            close()
            if (row.unread) model.markRead(row.spot) else model.markUnread(row.spot)
        },
    )
}

@Composable
private fun ConversationRowView(row: ConversationRow, pinned: Boolean) {
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
                if (pinned) Icon(Icons.Filled.PushPin, contentDescription = "Pinned", tint = tone.ink3, modifier = Modifier.padding(start = 6.dp).size(14.dp))
                row.last?.let {
                    Text(
                        When.list(it.millis),
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
    return buildAnnotatedString { words(row, tone) }
}

private fun androidx.compose.ui.text.AnnotatedString.Builder.words(row: ConversationRow, tone: com.kiwiinit.channels.theme.Tones) {
    val need = row.need
    val line = row.line
    if (need != null) {
        withStyle(SpanStyle(color = tone.decide, fontWeight = FontWeight.SemiBold)) { append("Needs you: ") }
        append(need)
        if (row.needs > 1) append(" · ${row.needs}")
    } else if (row.draft != null && line.startsWith("Draft: ")) {
        withStyle(SpanStyle(color = tone.alert)) { append("Draft: ") }
        append(line.removePrefix("Draft: "))
    } else {
        append(line)
    }
}

@Composable
private fun Hit(row: ConversationRow, message: MessageView, query: String, open: () -> Unit) {
    val tone = Tone.current
    val words = (if (message.mine) "You: " else "${row.room.display(message.from)}: ") + message.plain.oneLine()
    val at = words.lowercase().indexOf(query)
    val strong = MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().clickable(onClick = open).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Top,
    ) {
        RowAvatar(row, 32.dp)
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Row {
                Text(row.fullTitle, style = MaterialTheme.typography.labelLarge, maxLines = 1, modifier = Modifier.weight(1f))
                Text(When.list(message.millis), style = MaterialTheme.typography.labelMedium, color = tone.ink3)
            }
            Text(
                buildAnnotatedString {
                    if (at < 0) {
                        append(words)
                    } else {
                        append(words.substring(0, at))
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = strong)) { append(words.substring(at, at + query.length)) }
                        append(words.substring(at + query.length))
                    }
                },
                style = MaterialTheme.typography.bodyMedium,
                color = tone.ink2,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp).clip(RoundedCornerShape(16.dp)).background(tone.them).padding(horizontal = 12.dp, vertical = 7.dp),
            )
        }
    }
}
