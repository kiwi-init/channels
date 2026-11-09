package com.kiwiinit.channels.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.needing

enum class Tab { Chats, Needs, Settings }

@Composable
fun Home(model: AppModel, open: (Spot) -> Unit, tasks: (String) -> Unit, first: Tab = Tab.Chats) {
    var tab by rememberSaveable { mutableStateOf(first) }
    BackHandler(enabled = tab != Tab.Chats) { tab = Tab.Chats }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                Tab.Chats -> ConversationList(model, open, tasks)
                Tab.Needs -> NeedsList(model)
                Tab.Settings -> SettingsScreen(model)
            }
        }
        NavigationBar {
            TabItem("Chats", Icons.Filled.Forum, Icons.Outlined.Forum, tab == Tab.Chats, 0) { tab = Tab.Chats }
            TabItem("Needs you", Icons.Filled.PanTool, Icons.Outlined.PanTool, tab == Tab.Needs, model.needing) { tab = Tab.Needs }
            TabItem("You", Icons.Filled.AccountCircle, Icons.Outlined.AccountCircle, tab == Tab.Settings, 0) { tab = Tab.Settings }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.TabItem(label: String, on: ImageVector, off: ImageVector, selected: Boolean, count: Int, pick: () -> Unit) {
    NavigationBarItem(
        selected = selected,
        onClick = pick,
        label = { Text(label) },
        icon = {
            BadgedBox(badge = { if (count > 0) Badge { Text("$count") } }) {
                Icon(if (selected) on else off, contentDescription = null)
            }
        },
    )
}

@Composable
internal fun BigTitle(title: String, trailing: @Composable () -> Unit = {}) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 8.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        trailing()
    }
}
