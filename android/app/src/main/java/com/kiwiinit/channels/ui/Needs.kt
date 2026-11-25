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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.NeedView
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
import androidx.compose.ui.res.stringResource
import com.kiwiinit.channels.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Screen(title: String, back: () -> Unit, content: @Composable (PaddingValues) -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back)) }
                },
            )
        },
    ) { padding -> content(PaddingValues(top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp)) }
}

@Composable
fun NeedsList(model: AppModel, open: (Spot) -> Unit = {}) {
    val many = model.channels.size > 1
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface)) {
        BigTitle(stringResource(R.string.needs_you))
        LazyColumn(Modifier.fillMaxSize().imePadding(), contentPadding = PaddingValues(top = 4.dp, bottom = 16.dp)) {
            if (model.channels.none { it.asks.isNotEmpty() || it.reviews.isNotEmpty() || it.needs.isNotEmpty() }) {
                item(key = "none") { Centered(stringResource(R.string.nothing_needs_you), stringResource(R.string.nothing_needs_you_lead), Modifier.padding(top = 80.dp)) }
            }
            for (room in model.channels) {
                if (room.asks.isEmpty() && room.reviews.isEmpty() && room.needs.isEmpty()) continue
                if (many) item(key = "head-${room.code}") { Header(room.title, Tone.current.ink3) }
                items(room.needs, key = { "need-${room.code}-${it.id}" }) { need -> Card { NeedRow(model, room, need, open) } }
                items(room.asks, key = { "ask-${room.code}-${it.seq}" }) { ask -> Card { NeedsYouRow(model, room, ask, open) } }
                items(room.reviews, key = { "review-${room.code}-${it.task}" }) { review -> Card { ReviewRow(model, room, review, open) } }
            }
        }
    }
}

@Composable
fun TasksScreen(model: AppModel, code: String, open: (Spot) -> Unit, back: () -> Unit) {
    val room = model.rooms[code]
    Screen(room?.let { stringResource(R.string.tasks_in, it.title) } ?: stringResource(R.string.tasks), back) { padding ->
        if (room == null) {
            Centered(stringResource(R.string.channel_gone), stringResource(R.string.channel_gone_lead), Modifier.padding(padding))
            return@Screen
        }
        val live = room.tasks.filter { !it.archived }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
            if (live.isEmpty()) item(key = "none") { Centered(stringResource(R.string.nothing_open), stringResource(R.string.nothing_open_lead), Modifier.padding(top = 80.dp)) }
            for ((state, title) in TASK_STATES) {
                val these = live.filter { it.state == state }
                if (these.isEmpty()) continue
                item(key = "head-$state") { Header("${stringResource(title)} · ${these.size}", if (state == "review") Tone.current.decide else Tone.current.ink3) }
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

internal val TASK_STATES = listOf("doing" to R.string.state_doing, "review" to R.string.state_review, "todo" to R.string.state_todo, "done" to R.string.state_done)

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
private fun NeedsYouRow(model: AppModel, room: RoomView, ask: AskView, open: (Spot) -> Unit) {
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
                listOfNotNull(room.display(ask.from), ask.task?.let(::taskLabel), When.short(words(), ask.millis)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text(askLabel(ask.label), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = tone.decide)
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
                            if (text.isEmpty()) Text(stringResource(R.string.your_answer), style = MaterialTheme.typography.bodyLarge, color = tone.ink3)
                            inner()
                        }
                    },
                )
                FilledIconButton(onClick = { submit(text) }, enabled = text.isNotBlank() && sending == null, modifier = Modifier.size(40.dp)) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.send_answer), modifier = Modifier.size(18.dp))
                }
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (ask.choices.isEmpty()) stringResource(R.string.answer) else stringResource(R.string.something_else),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { replying = true }.padding(vertical = 6.dp, horizontal = 4.dp),
                )
                Spacer(Modifier.weight(1f))
                OpenLink("open-ask-${ask.seq}") { open(Spot(room.code, ask.place ?: ask.task?.let { "task:$it" } ?: "main")) }
            }
        }
        if (failed) Text(stringResource(R.string.send_failed), style = MaterialTheme.typography.labelMedium, color = tone.alert)
    }
}

@Composable
private fun ReviewRow(model: AppModel, room: RoomView, review: ReviewView, open: (Spot) -> Unit) {
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
                listOfNotNull(by?.let { room.display(it) }, taskLabel(review.task), When.short(words(), review.millis)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.weight(1f),
                maxLines = 1,
            )
            Text(stringResource(R.string.review), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = tone.decide)
        }
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(color = tone.ink3)) { append(taskLabel(review.task)) }
                append(" ${review.title}")
            },
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Text(stringResource(R.string.review_lead), style = MaterialTheme.typography.bodySmall, color = tone.ink3)
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
                Text(stringResource(R.string.approve), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.send_back),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable(enabled = !busy) { why = "" }.padding(vertical = 6.dp, horizontal = 4.dp),
                )
                Spacer(Modifier.weight(1f))
                OpenLink("open-review-${review.task}") { open(Spot(room.code, "task:${review.task}")) }
            }
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
                            if (writing.isEmpty()) Text(stringResource(R.string.what_to_change), style = MaterialTheme.typography.bodyLarge, color = tone.ink3)
                            inner()
                        }
                    },
                )
                FilledIconButton(
                    onClick = { act { model.sendBack(room.code, review.task, writing.trim()) } },
                    enabled = writing.isNotBlank() && !busy,
                    modifier = Modifier.size(40.dp),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.send_back), modifier = Modifier.size(18.dp))
                }
            }
        }
        if (failed) Text(stringResource(R.string.send_failed), style = MaterialTheme.typography.labelMedium, color = tone.alert)
    }
}

private class Act(val title: String, val color: Color, val go: suspend () -> Unit)

@Composable
private fun NeedRow(model: AppModel, room: RoomView, need: NeedView, open: (Spot) -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val scope = rememberCoroutineScope()
    var busy by remember(need.id) { mutableStateOf<String?>(null) }
    var failed by remember(need.id) { mutableStateOf<String?>(null) }
    var whole by remember(need.id) { mutableStateOf(false) }
    val ink = MaterialTheme.colorScheme.onSurface

    fun act(action: Act) {
        if (busy != null) return
        busy = action.title
        failed = null
        view.buzz(Buzz.Tap)
        scope.launch {
            try {
                action.go()
                view.buzz(Buzz.Done)
            } catch (e: EngineException) {
                failed = e.message
                view.buzz(Buzz.Fail)
            }
            busy = null
        }
    }

    val asker = if (need.kind == "join") null else need.asker
    val label = when (need.kind) {
        "permission" -> stringResource(R.string.permission_for_you)
        "join" -> if (need.who == "human") stringResource(R.string.join_person) else stringResource(R.string.join_agent)
        else -> if (need.changed) stringResource(R.string.spec_changed) else stringResource(R.string.spec_ready)
    }
    val allowOnce = stringResource(R.string.allow_once)
    val deny = stringResource(R.string.deny)
    val letIn = stringResource(R.string.let_in)
    val approve = stringResource(R.string.approve)
    val ask = need.ask
    val v = need.v
    val actions = when (need.kind) {
        "permission" -> listOfNotNull(
            if (need.canAllow) Act(allowOnce, ink) { model.allow(room.code, need.id, true) } else null,
            Act(deny, tone.alert) { model.allow(room.code, need.id, false) },
        )
        "join" -> if (need.pinned || !room.isOwner) emptyList() else listOf(Act(letIn, ink) { model.letIn(room.code, need.id) })
        else -> if (ask != null && v != null) listOf(Act(approve, ink) { model.approveSpec(room.code, ask, v) }) else emptyList()
    }
    val allower = need.allower
    val note = when {
        need.kind == "permission" && !need.canAllow -> if (allower != null) stringResource(R.string.only_can_allow, room.display(allower)) else stringResource(R.string.you_can_deny)
        need.kind == "join" && need.pinned -> stringResource(R.string.join_pinned)
        need.kind == "join" && !room.isOwner -> stringResource(R.string.only_owner_lets_in)
        need.kind == "join" && !need.code.isNullOrEmpty() -> stringResource(R.string.join_same_code)
        else -> null
    }

    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (asker != null) Face(asker, room.member(asker), 24.dp)
            Text(
                listOfNotNull(asker?.let { room.display(it) }, need.task?.let(::taskLabel), When.short(words(), need.millis)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = tone.decide)
        }
        when (need.kind) {
            "permission" -> {
                Text(need.title ?: stringResource(R.string.use_a_tool), style = MaterialTheme.typography.bodyLarge, color = ink)
                need.summary?.takeIf { it.isNotEmpty() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = tone.ink2) }
                need.code?.takeIf { it.isNotEmpty() }?.let { code ->
                    Text(
                        code,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = tone.ink2,
                        maxLines = if (whole) Int.MAX_VALUE else 6,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(tone.wash2).clickable { whole = !whole }.padding(8.dp),
                    )
                }
            }
            "join" -> {
                Text(need.name ?: stringResource(R.string.someone), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = ink)
                val sponsor = need.sponsor?.takeIf { it.isNotEmpty() }?.let { stringResource(R.string.from_computer, room.display(it)) }
                val about = listOfNotNull(need.runs, need.machine, sponsor).filter { it.isNotEmpty() }
                if (about.isNotEmpty()) Text(about.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, color = tone.ink2)
                val codeWord = stringResource(R.string.join_code)
                need.code?.takeIf { it.isNotEmpty() }?.let { code ->
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(color = tone.ink3)) { append(codeWord) }
                            append(" ")
                            withStyle(SpanStyle(fontFamily = FontFamily.Monospace)) { append(if (code.length == 6) "${code.take(3)}-${code.takeLast(3)}" else code) }
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        color = ink,
                    )
                }
            }
            else -> {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(color = tone.ink3)) { append("#${ask ?: 0} ") }
                        append(need.title.orEmpty())
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    color = ink,
                )
                need.text?.takeIf { it.isNotEmpty() }?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = tone.ink2,
                        maxLines = if (whole) Int.MAX_VALUE else 8,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { whole = !whole },
                    )
                }
            }
        }
        for (action in actions) {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(tone.wash2)
                    .clickable(enabled = busy == null) { act(action) }
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(action.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = action.color, modifier = Modifier.weight(1f))
                if (busy == action.title) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            }
        }
        val problem = failed
        if (problem != null) {
            Text(problem, style = MaterialTheme.typography.labelMedium, color = tone.alert)
        } else if (note != null) {
            Text(note, style = MaterialTheme.typography.labelMedium, color = tone.ink3)
        }
        Row(Modifier.fillMaxWidth()) {
            Spacer(Modifier.weight(1f))
            OpenLink("open-need-${need.id}") { open(Spot(room.code, need.task?.let { "task:$it" } ?: "main")) }
        }
    }
}

@Composable
private fun OpenLink(tag: String, go: () -> Unit) {
    Text(
        stringResource(R.string.open_conversation),
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier.testTag(tag).clip(RoundedCornerShape(8.dp)).clickable(onClick = go).padding(vertical = 6.dp, horizontal = 4.dp),
    )
}

private val ASK_LABELS = mapOf(
    "Decision for you" to R.string.ask_decision,
    "A step for you" to R.string.ask_step,
    "Intent check for you" to R.string.ask_intent,
    "Taste call for you" to R.string.ask_taste,
    "Irreversible step for you" to R.string.ask_irreversible,
    "Scope call for you" to R.string.ask_scope,
    "Question for you" to R.string.question_for_you,
    "Question for everyone" to R.string.ask_everyone,
)

@Composable
private fun askLabel(label: String): String = ASK_LABELS[label]?.let { stringResource(it) } ?: label
