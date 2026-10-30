package com.kiwiinit.channels.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Tag
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.other
import com.kiwiinit.channels.model.spotTitle
import com.kiwiinit.channels.model.taskLabel
import com.kiwiinit.channels.theme.Tone
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailsScreen(model: AppModel, code: String, current: String, back: () -> Unit, choose: (String) -> Unit, newAgent: () -> Unit) {
    val room = model.rooms[code]
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(room?.spotTitle(current) ?: "Details", maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding ->
        if (room == null) {
            Centered("This channel is gone", "Its owner closed it, or this phone was removed from it.", Modifier.padding(padding))
        } else {
            ChannelDetails(model, room, current, choose, newAgent, PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp))
        }
    }
}

@Composable
private fun ChannelDetails(model: AppModel, room: RoomView, current: String, choose: (String) -> Unit, newAgent: () -> Unit, padding: PaddingValues) {
    val tone = Tone.current
    val view = LocalView.current
    val spot = Spot(room.code, current)
    val pinned = model.isPinned(spot)
    val lead = room.members.filter { it.lead }
    val rest = room.members.filter { !it.lead && it.name != room.me }.sortedWith(compareBy<MemberView>({ if (it.working) 0 else 1 }, { it.display }))
    val me = room.members.filter { it.name == room.me && !it.lead }
    val crew = lead + rest + me
    val count = "${room.members.size} ${if (room.members.size == 1) "person" else "people"}"
    val summary = if (room.working > 0) "$count · ${room.working} working" else count
    LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = padding) {
        item(key = "head") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                ChannelAvatar(room, 96.dp)
                Text(
                    room.title,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 12.dp),
                )
                Text(summary, style = MaterialTheme.typography.bodyMedium, color = tone.ink3, modifier = Modifier.padding(top = 2.dp))
                Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    val other = room.other(spot)
                    if (other != null) {
                        Action(
                            if (other.general) Icons.Filled.Tag else Icons.AutoMirrored.Outlined.Chat,
                            if (other.general) "# general" else room.spotTitle(other.place),
                            Modifier.weight(1f),
                        ) { choose(other.place) }
                    }
                    Action(if (pinned) Icons.Outlined.PushPin else Icons.Filled.PushPin, if (pinned) "Unpin" else "Pin", Modifier.weight(1f)) {
                        view.buzz(Buzz.Tap)
                        model.togglePin(spot)
                    }
                    if (room.isOwner) {
                        Action(Icons.Filled.Add, "New agent", Modifier.weight(1f)) {
                            view.buzz(Buzz.Tap)
                            newAgent()
                        }
                    }
                }
            }
        }
        if (room.asks.isNotEmpty() || room.reviews.isNotEmpty()) {
            item(key = "needs") { Header("Needs you", tone.decide) }
            items(room.asks, key = { "ask-${it.seq}" }) { ask -> Card { NeedsYouRow(model, room, ask) } }
            items(room.reviews, key = { "review-${it.task}" }) { review -> Card { ReviewRow(model, room, review) } }
        }
        item(key = "crew") { Header("Crew", tone.ink3) }
        item(key = "crew-list") {
            Card {
                crew.forEachIndexed { i, m ->
                    Person(room, m) { room.sideKey?.let(choose) }
                    if (i < crew.size - 1) Box(Modifier.fillMaxWidth().padding(start = 64.dp).heightIn(min = 1.dp).background(tone.line))
                }
            }
        }
        if (room.hold != null || room.charter != null) {
            item(key = "about") { Header("About", tone.ink3) }
            item(key = "about-card") {
                Card {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        room.hold?.let {
                            Text(if (it.isEmpty()) "On hold" else "On hold: $it", style = MaterialTheme.typography.bodyMedium, color = tone.decide)
                        }
                        room.charter?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = tone.ink2, maxLines = 8) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(title: String, color: androidx.compose.ui.graphics.Color) {
    Text(
        title,
        style = MaterialTheme.typography.labelLarge,
        color = color,
        modifier = Modifier.padding(start = 32.dp, end = 16.dp, top = 22.dp, bottom = 8.dp),
    )
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        content()
    }
}

@Composable
private fun Action(icon: ImageVector, title: String, modifier: Modifier, tap: () -> Unit) {
    Column(
        modifier.heightIn(min = 64.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = tap)
            .padding(vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Text(
            title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp, start = 8.dp, end = 8.dp),
        )
    }
}

@Composable
private fun Person(room: RoomView, m: MemberView, chat: () -> Unit) {
    val tone = Tone.current
    val canChat = m.lead && m.name != room.me && room.sideKey != null
    val what = if (m.lead) "Lead" else if (m.owner) "Owner" else if (m.isAgent) "Agent" else "Person"
    val now = if (m.working) {
        val task = m.doing.firstOrNull()?.let { id -> room.tasks.firstOrNull { it.id == id } }
        task?.let { "working on ${taskLabel(it.id)} ${it.title}" } ?: "working"
    } else if (m.here) {
        "here"
    } else {
        "away"
    }
    Row(
        Modifier.fillMaxWidth().then(if (canChat) Modifier.clickable(onClick = chat) else Modifier).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Face(m.name, m, 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(m.display, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
                if (m.name == room.me) Text("you", style = MaterialTheme.typography.labelMedium, color = tone.ink3)
            }
            Text("$what · $now", style = MaterialTheme.typography.bodySmall, color = if (m.working) tone.doing else tone.ink3, maxLines = 1)
        }
        if (canChat) Icon(Icons.AutoMirrored.Outlined.Chat, contentDescription = "Message", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
    }
}

@Composable
private fun NeedsYouRow(model: AppModel, room: RoomView, ask: AskView) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var sending by remember(ask.seq) { mutableStateOf<String?>(null) }
    var replying by remember(ask.seq) { mutableStateOf(false) }
    var text by remember(ask.seq) { mutableStateOf("") }
    var failed by remember(ask.seq) { mutableStateOf(false) }

    fun submit(words: String) {
        val said = words.trim()
        if (said.isEmpty()) return
        sending = said
        failed = false
        view.buzz(Buzz.Tap)
        scope.launch {
            try {
                model.answer(room.code, ask.seq, said)
                view.buzz(Buzz.Done)
                text = ""
                replying = false
            } catch (e: EngineException) {
                failed = true
                view.buzz(Buzz.Fail)
            }
            sending = null
        }
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Face(ask.from, room.member(ask.from), 24.dp)
            Text(
                listOfNotNull(room.display(ask.from), ask.task?.let(::taskLabel), When.short(ask.millis)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text(ask.label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = tone.decide)
        }
        Markdown(ask.shown, Inks(MaterialTheme.colorScheme.onSurface, MaterialTheme.colorScheme.primary, tone.wash2, false))
        for (choice in ask.choices) {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(tone.wash2)
                    .clickable(enabled = sending == null) { submit(choice) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(choice, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                if (sending == choice) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            }
        }
        if (replying) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicTextField(
                    value = text,
                    onValueChange = { text = it },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(tone.wash2).padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { inner ->
                        Box {
                            if (text.isEmpty()) Text("Your answer", style = MaterialTheme.typography.bodyLarge, color = tone.ink3)
                            inner()
                        }
                    },
                )
                FilledIconButton(onClick = { submit(text) }, enabled = text.isNotBlank() && sending == null, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send answer", modifier = Modifier.size(18.dp))
                }
            }
        } else {
            Text(
                if (ask.choices.isEmpty()) "Answer" else "Something else",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { replying = true }.padding(vertical = 6.dp, horizontal = 4.dp),
            )
        }
        if (failed) Text("Couldn't send · Try again", style = MaterialTheme.typography.labelMedium, color = tone.alert)
    }
}

@Composable
private fun ReviewRow(model: AppModel, room: RoomView, review: ReviewView) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var busy by remember(review.task) { mutableStateOf(false) }
    var failed by remember(review.task) { mutableStateOf(false) }
    var why by remember(review.task) { mutableStateOf<String?>(null) }

    fun act(work: suspend () -> Unit) {
        busy = true
        failed = false
        view.buzz(Buzz.Tap)
        scope.launch {
            try {
                work()
                why = null
                view.buzz(Buzz.Done)
            } catch (e: EngineException) {
                failed = true
                view.buzz(Buzz.Fail)
            }
            busy = false
        }
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val by = review.by
            if (by != null) Face(by, room.member(by), 24.dp)
            Text(
                listOfNotNull(by?.let { room.display(it) }, taskLabel(review.task), When.short(review.millis)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text("Review", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = tone.decide)
        }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = tone.ink3)) { append(taskLabel(review.task)) }
                append(" ${review.title}")
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text("Ready for your review · check the work itself, not just the word", style = MaterialTheme.typography.bodySmall, color = tone.ink3)
        val writing = why
        if (writing == null) {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(tone.wash2)
                    .clickable(enabled = !busy) { act { model.approve(room.code, review.task) } }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Approve", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            }
            Text(
                "Send back",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = !busy) { why = "" }.padding(vertical = 6.dp, horizontal = 4.dp),
            )
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BasicTextField(
                    value = writing,
                    onValueChange = { why = it },
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                    modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(tone.wash2).padding(horizontal = 12.dp, vertical = 10.dp),
                    decorationBox = { inner ->
                        Box {
                            if (writing.isEmpty()) Text("What to change", style = MaterialTheme.typography.bodyLarge, color = tone.ink3)
                            inner()
                        }
                    },
                )
                FilledIconButton(
                    onClick = { act { model.sendBack(room.code, review.task, writing.trim()) } },
                    enabled = writing.isNotBlank() && !busy,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send back", modifier = Modifier.size(18.dp))
                }
            }
        }
        if (failed) Text("Couldn't send · Try again", style = MaterialTheme.typography.labelMedium, color = tone.alert)
    }
}
