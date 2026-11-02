package com.kiwiinit.channels.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.Tone
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ThreadSheet(model: AppModel, spot: Spot, root: MessageView, close: () -> Unit) {
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        ThreadPane(model, spot, root, Modifier.fillMaxHeight(0.92f))
    }
}

@Composable
fun ThreadPane(model: AppModel, spot: Spot, root: MessageView, modifier: Modifier = Modifier) {
    val room = model.rooms[spot.code] ?: return
    val tone = Tone.current
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    val state = rememberLazyListState()
    val follow = remember { Follow() }
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf<String?>(null) }
    val thread = room.thread?.takeIf { it.root.seq == root.seq }
    val shown = remember(room, thread, root) {
        room.copy(messages = listOf(thread?.root ?: root) + (thread?.replies ?: emptyList()), asks = emptyList(), reviews = emptyList(), place = spot.place)
    }
    DisposableEffect(spot.code, root.seq) {
        model.openThread(spot.code, root.seq)
        onDispose { model.openThread(spot.code, null) }
    }
    val ready = !sending && text.isNotBlank()
    fun send() {
        val body = text.trim()
        if (body.isEmpty() || sending) return
        sending = true
        failed = null
        text = ""
        scope.launch {
            try {
                model.send(spot, body, root.seq, side = true)
            } catch (e: EngineException) {
                text = body
                failed = "Not delivered: ${e.message}"
            }
            sending = false
        }
    }
    Column(modifier.fillMaxWidth().imePadding()) {
        Text(
            "Thread",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp),
        )
        Conversation(
            model = model,
            room = shown,
            spot = Spot(spot.code, "thread:${root.seq}"),
            state = state,
            follow = follow,
            elsewhere = emptyList(),
            reviews = emptyList(),
            reply = { focus.requestFocus() },
            answer = {},
            sendBack = {},
            modifier = Modifier.weight(1f),
            intro = false,
        )
        failed?.let {
            Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 20.dp))
        }
        Row(
            Modifier.fillMaxWidth()
                .padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 8.dp)
                .heightIn(min = 48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
            verticalAlignment = Alignment.Bottom,
        ) {
            BasicTextField(
                value = text,
                onValueChange = { text = it },
                modifier = Modifier.weight(1f).padding(start = 18.dp, end = 8.dp, top = 13.dp, bottom = 13.dp).focusRequester(focus),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                maxLines = 6,
                decorationBox = { inner ->
                    Box {
                        if (text.isEmpty()) Text("Reply in thread", style = MaterialTheme.typography.bodyLarge, color = tone.ink3, maxLines = 1)
                        inner()
                    }
                },
            )
            if (ready || sending) {
                FilledIconButton(onClick = { send() }, enabled = ready, modifier = Modifier.padding(end = 6.dp, bottom = 6.dp).size(36.dp)) {
                    if (sending) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                    } else {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", modifier = Modifier.size(18.dp))
                    }
                }
            } else {
                Spacer(Modifier.size(6.dp))
            }
        }
    }
}
