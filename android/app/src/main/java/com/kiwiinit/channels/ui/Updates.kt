package com.kiwiinit.channels.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.MonitorHeart
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.R
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.RoomView

data class UpdatesDay(val day: Long, val list: List<MessageView>)

fun updatesByDay(messages: List<MessageView>): List<UpdatesDay> {
    val out = mutableListOf<UpdatesDay>()
    for (m in messages.asReversed()) {
        if (!m.event) continue
        val last = out.lastOrNull()
        if (last != null && When.sameDay(last.day, m.millis)) out[out.size - 1] = last.copy(list = last.list + m)
        else out += UpdatesDay(m.millis, listOf(m))
    }
    return out
}

@Composable
fun UpdatesButton(open: () -> Unit) {
    IconButton(onClick = open) {
        Icon(Icons.Outlined.MonitorHeart, contentDescription = stringResource(R.string.updates))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesSheet(room: RoomView, close: () -> Unit) {
    val sheet = rememberModalBottomSheetState()
    ModalBottomSheet(onDismissRequest = close, sheetState = sheet) {
        Updates(room, close)
    }
}

@Composable
fun Updates(room: RoomView, close: () -> Unit) {
    val tone = Tone.current
    val w = words()
    val days = updatesByDay(room.messages)
    Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.updates), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            IconButton(onClick = close) { Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.close)) }
        }
        LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 16.dp)) {
            for (day in days) {
                item(key = "d${day.day}") {
                    Text(
                        When.dayWord(w, day.day),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = tone.ink3,
                        modifier = Modifier.padding(top = 14.dp, bottom = 6.dp),
                    )
                }
                items(day.list, key = { "u${it.seq}" }) { m ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("${room.display(m.from)} ${m.body}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                        Text(When.clock(m.millis), style = MaterialTheme.typography.labelMedium, color = tone.ink3)
                    }
                }
            }
        }
    }
}
