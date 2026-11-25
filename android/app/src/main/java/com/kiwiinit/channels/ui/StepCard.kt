package com.kiwiinit.channels.ui

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.R
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.engine.StepOutcome
import com.kiwiinit.channels.engine.StepView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.theme.Radius
import com.kiwiinit.channels.theme.Tone
import kotlinx.coroutines.launch

const val STEP_NOTE = "step-note"

@Composable
private fun outcomeWords(outcome: StepOutcome): String =
    when (outcome) {
        StepOutcome.Done -> stringResource(R.string.step_done)
        StepOutcome.Cant -> stringResource(R.string.step_cant)
        StepOutcome.NotNeeded -> stringResource(R.string.step_not_needed)
    }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StepCard(model: AppModel, room: RoomView, message: MessageView, step: StepView, other: () -> Unit) {
    val tone = Tone.current
    val view = LocalView.current
    val links = LocalUriHandler.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var sending by remember(message.seq) { mutableStateOf<StepOutcome?>(null) }
    var failed by remember(message.seq) { mutableStateOf(false) }
    var reasonFor by remember(message.seq) { mutableStateOf<StepOutcome?>(null) }
    var note by remember(message.seq) { mutableStateOf("") }
    val answer = message.stepAnswer
    val open = message.waiting && answer == null
    val send = { outcome: StepOutcome ->
        sending = outcome
        failed = false
        view.buzz(Buzz.Tap)
        scope.launch {
            try {
                model.answerStep(room.code, message.seq, outcome, note)
                view.buzz(Buzz.Done)
            } catch (e: EngineException) {
                sending = null
                failed = true
                view.buzz(Buzz.Fail)
            }
        }
        Unit
    }
    Column(
        Modifier.widthIn(max = 300.dp)
            .clip(RoundedCornerShape(Radius.bubble))
            .background(tone.them)
            .padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            if (open) stringResource(R.string.step_for_you) else stringResource(R.string.step_label),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = if (open) tone.decide else tone.ink3,
        )
        Markdown(message.shown, Inks(tone.onThem, MaterialTheme.colorScheme.primary, tone.wash2, false))
        Text(stringResource(R.string.step_needs_person, step.needsPerson), style = MaterialTheme.typography.bodySmall, color = tone.ink3)
        Text(step.why, style = MaterialTheme.typography.bodyMedium, color = tone.onThem)
        step.todo.forEachIndexed { i, line ->
            Text("${i + 1}. $line", style = MaterialTheme.typography.bodyMedium, color = tone.onThem)
        }
        val copy = stringResource(R.string.copy)
        step.run.forEach { command ->
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(tone.wash2)
                    .clickable(onClickLabel = copy) {
                        scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText(copy, command))) }
                        view.buzz(Buzz.Done)
                    }
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(command, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, color = tone.onThem, modifier = Modifier.weight(1f))
                Icon(Icons.Filled.ContentCopy, contentDescription = null, tint = tone.ink3, modifier = Modifier.size(14.dp))
            }
        }
        step.expect?.let { expected ->
            Text(stringResource(R.string.step_expected), style = MaterialTheme.typography.labelMedium, color = tone.ink3)
            Text(expected, style = MaterialTheme.typography.bodyMedium, color = tone.onThem)
        }
        step.links.forEach { link ->
            Text(
                link,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary,
                textDecoration = TextDecoration.Underline,
                modifier = Modifier.clickable {
                    try {
                        links.openUri(link)
                    } catch (e: IllegalArgumentException) {
                        // No app on the phone opens this kind of link; the tap does nothing, as one in a message does.
                    }
                },
            )
        }
        if (open) {
            HorizontalDivider(color = tone.line)
            val asking = reasonFor
            BasicTextField(
                value = note,
                onValueChange = { note = it },
                textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.fillMaxWidth().testTag(STEP_NOTE).clip(RoundedCornerShape(10.dp)).background(tone.wash2).padding(horizontal = 10.dp, vertical = 8.dp),
                decorationBox = { inner ->
                    Box {
                        if (note.isEmpty()) {
                            Text(
                                stringResource(
                                    when (asking) {
                                        null, StepOutcome.Done -> R.string.step_output_hint
                                        StepOutcome.Cant -> R.string.step_why_cant
                                        StepOutcome.NotNeeded -> R.string.step_why_not_needed
                                    },
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = tone.ink3,
                            )
                        }
                        inner()
                    }
                },
            )
            if (asking == null || asking == StepOutcome.Done) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { send(StepOutcome.Done) }, enabled = sending == null) { Text(stringResource(R.string.step_done)) }
                    OutlinedButton(onClick = { reasonFor = StepOutcome.Cant }, enabled = sending == null) { Text(stringResource(R.string.step_cant)) }
                    OutlinedButton(onClick = { reasonFor = StepOutcome.NotNeeded }, enabled = sending == null) { Text(stringResource(R.string.step_not_needed)) }
                }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { send(asking) }, enabled = sending == null && note.isNotBlank()) { Text(stringResource(R.string.step_send)) }
                    OutlinedButton(onClick = { reasonFor = null }, enabled = sending == null) { Text(stringResource(R.string.cancel)) }
                }
            }
            Row(
                Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = other),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(Icons.AutoMirrored.Filled.Reply, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp).padding(start = 2.dp))
                Text(stringResource(R.string.something_else_more), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary)
            }
        }
        if (answer != null) {
            val who = if (answer.by == room.me) stringResource(R.string.you) else room.display(answer.by)
            val outcome = answer.outcome
            Text(
                if (outcome != null) stringResource(R.string.step_answered, who, outcomeWords(outcome)) else stringResource(R.string.step_replied, who),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
            )
        } else if (failed) {
            Text(stringResource(R.string.send_failed), style = MaterialTheme.typography.labelMedium, color = tone.alert)
        }
    }
}
