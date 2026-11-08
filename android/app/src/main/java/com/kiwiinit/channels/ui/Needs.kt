package com.kiwiinit.channels.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
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
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.engine.TaskView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.oneLine
import com.kiwiinit.channels.model.taskLabel
import com.kiwiinit.channels.theme.Tone
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Screen(title: String, back: () -> Unit, content: @Composable (PaddingValues) -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
                },
            )
        },
    ) { padding -> content(PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp)) }
}

@Composable
fun NeedsScreen(model: AppModel, back: () -> Unit) {
    val many = model.channels.size > 1
    Screen("Needs you", back) { padding ->
        LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = padding) {
            if (model.channels.none { it.asks.isNotEmpty() || it.reviews.isNotEmpty() }) {
                item(key = "none") { Centered("Nothing needs you", "Questions, decisions and reviews show up here.", Modifier.padding(top = 80.dp)) }
            }
            for (room in model.channels) {
                if (room.asks.isEmpty() && room.reviews.isEmpty()) continue
                if (many) item(key = "head-${room.code}") { Header(room.title, Tone.current.ink3) }
                items(room.asks, key = { "ask-${room.code}-${it.seq}" }) { ask -> Card { NeedsYouRow(model, room, ask) } }
                items(room.reviews, key = { "review-${room.code}-${it.task}" }) { review -> Card { ReviewRow(model, room, review) } }
            }
        }
    }
}

@Composable
fun TasksScreen(model: AppModel, code: String, open: (Spot) -> Unit, back: () -> Unit) {
    val room = model.rooms[code]
    Screen(room?.let { "Tasks · ${it.title}" } ?: "Tasks", back) { padding ->
        if (room == null) {
            Centered("This channel is gone", "Its owner closed it, or this phone was removed from it.", Modifier.padding(padding))
            return@Screen
        }
        val live = room.tasks.filter { !it.archived }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
            if (live.isEmpty()) item(key = "none") { Centered("Nothing open", "Tasks your lead hands out show up here.", Modifier.padding(top = 80.dp)) }
            for ((state, title) in TASK_STATES) {
                val these = live.filter { it.state == state }
                if (these.isEmpty()) continue
                item(key = "head-$state") { Header("$title · ${these.size}", if (state == "review") Tone.current.decide else Tone.current.ink3) }
                item(key = "list-$state") {
                    Card {
                        these.forEachIndexed { i, task ->
                            TaskRow(room, task) { open(Spot(room.code, "task:${task.id}")) }
                            if (i < these.size - 1) Box(Modifier.fillMaxWidth().padding(start = 16.dp).heightIn(min = 1.dp).background(Tone.current.line))
                        }
                    }
                }
            }
        }
    }
}

private val TASK_STATES = listOf("doing" to "Working", "review" to "In review", "todo" to "To do", "done" to "Done")

@Composable
private fun TaskRow(room: RoomView, task: TaskView, open: () -> Unit) {
    val tone = Tone.current
    Column(Modifier.fillMaxWidth().clickable(onClick = open).padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = tone.ink3)) { append(taskLabel(task.id)) }
                append(" ${task.title}")
            },
            style = MaterialTheme.typography.bodyLarge,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        val who = task.owner?.let { room.display(it) }
        val line = listOfNotNull(who, task.last?.oneLine()).joinToString(" · ")
        if (line.isNotEmpty()) Text(line, style = MaterialTheme.typography.bodySmall, color = if (task.state == "doing") tone.doing else tone.ink3, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
