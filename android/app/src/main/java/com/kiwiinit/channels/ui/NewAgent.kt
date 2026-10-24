package com.kiwiinit.channels.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.outlined.Circle
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.kiwiinit.channels.engine.ComputerView
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.HarnessChoice
import com.kiwiinit.channels.engine.HarnessesOn
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AgentChoices
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.LaunchSeen
import com.kiwiinit.channels.theme.Tone
import kotlin.coroutines.resume
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

sealed interface Loaded<out T> {
    data object Loading : Loaded<Nothing>

    data class Failed(val why: String) : Loaded<Nothing>

    data class Ready<T>(val value: T) : Loaded<T>
}

sealed interface AgentStep {
    data object Computer : AgentStep

    data class Harness(val computer: ComputerView) : AgentStep

    data class Folder(val computer: ComputerView, val harness: HarnessChoice, val bypass: Boolean) : AgentStep

    data class Options(val computer: ComputerView, val harness: HarnessChoice, val bypass: Boolean, val folder: String) : AgentStep
}

sealed interface Starting {
    data object Sending : Starting

    data class Started(val launch: String) : Starting

    data class Failed(val why: String) : Starting
}

@Composable
fun NewAgentScreen(model: AppModel, code: String, close: () -> Unit) {
    val room = model.rooms[code]
    var steps by remember { mutableStateOf(listOf<AgentStep>(AgentStep.Computer)) }
    var starting by remember { mutableStateOf<Starting?>(null) }
    val step = steps.last()
    val scope = rememberCoroutineScope()
    val view = LocalView.current
    val activity = LocalContext.current.activity()

    fun go(next: AgentStep) {
        view.buzz(Buzz.Tap)
        steps = steps + next
    }

    fun back() {
        when (starting) {
            null -> if (steps.size > 1) steps = steps.dropLast(1) else close()
            is Starting.Failed -> starting = null
            is Starting.Started -> close()
            Starting.Sending -> Unit
        }
    }

    BackHandler(onBack = ::back)
    if (room == null) {
        NewAgentFrame("New agent", root = true, back = close) { Centered("This channel is gone", "Its owner closed it, or this phone was removed from it.") }
        return
    }
    val now = starting
    if (now != null && step is AgentStep.Options) {
        NewAgentFrame("New agent", root = false, back = if (now is Starting.Sending) null else ::back) {
            StartedList(room, step.computer, step.harness, now, (now as? Starting.Started)?.let { model.launches[it.launch] }, retry = { starting = null }, close = close)
        }
        return
    }
    NewAgentFrame(title(step), root = steps.size == 1, back = ::back) {
        when (step) {
            AgentStep.Computer -> {
                val (computers, retry) = loaded(Unit) { model.computers() }
                ComputerList(room, computers, retry) { go(AgentStep.Harness(it)) }
            }
            is AgentStep.Harness -> {
                val (harnesses, retry) = loaded(step.computer.key) { model.harnesses(step.computer.key) }
                HarnessList(step.computer, harnesses, retry) { h, bypass -> go(AgentStep.Folder(step.computer, h, bypass)) }
            }
            is AgentStep.Folder -> {
                val (folders, retry) = loaded(step.computer.key) { model.folders(step.computer.key, room.code) }
                FolderList(step.computer, folders, retry) { go(AgentStep.Options(step.computer, step.harness, step.bypass, it)) }
            }
            is AgentStep.Options -> OptionsForm(step.computer, step.harness, step.bypass, step.folder) { choices ->
                scope.launch {
                    if (choices.permission == "bypass") {
                        if (activity == null || !model.lock.available) {
                            starting = Starting.Failed("Bypass needs a screen lock on this phone. Set one in Settings, then try again.")
                            return@launch
                        }
                        if (!confirmBypass(activity, step.computer.name)) return@launch
                    }
                    view.buzz(Buzz.Tap)
                    starting = Starting.Sending
                    starting = try {
                        val launched = model.launch(room.code, step.computer.key, step.harness.harness, step.folder, choices)
                        val id = launched.launch
                        if (launched.ok && id != null) Starting.Started(id) else Starting.Failed(launched.detail ?: "${step.computer.name} couldn't start it.")
                    } catch (e: EngineException) {
                        Starting.Failed(e.message ?: "${step.computer.name} couldn't start it.")
                    }
                    view.buzz(if (starting is Starting.Started) Buzz.Done else Buzz.Fail)
                }
            }
        }
    }
}

private fun title(step: AgentStep): String =
    when (step) {
        AgentStep.Computer -> "New agent"
        is AgentStep.Harness -> "Harness"
        is AgentStep.Folder -> "Folder"
        is AgentStep.Options -> "Options"
    }

@Composable
private fun <T> loaded(key: Any, load: suspend () -> T): Pair<Loaded<T>, () -> Unit> {
    var state by remember(key) { mutableStateOf<Loaded<T>>(Loaded.Loading) }
    var attempt by remember(key) { mutableIntStateOf(0) }
    LaunchedEffect(key, attempt) {
        state = Loaded.Loading
        state = try {
            Loaded.Ready(load())
        } catch (e: EngineException) {
            Loaded.Failed(e.message ?: "That didn't work.")
        }
    }
    return state to { attempt++ }
}

private fun Context.activity(): FragmentActivity? = generateSequence(this) { (it as? ContextWrapper)?.baseContext }.filterIsInstance<FragmentActivity>().firstOrNull()

private suspend fun confirmBypass(activity: FragmentActivity, computer: String): Boolean =
    suspendCancellableCoroutine { done ->
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    if (done.isActive) done.resume(true)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    if (done.isActive) done.resume(false)
                }
            },
        )
        done.invokeOnCancellation { prompt.cancelAuthentication() }
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Start with bypass?")
                .setSubtitle("An agent on $computer that runs commands and changes files without asking first")
                .setAllowedAuthenticators(BIOMETRIC_WEAK or DEVICE_CREDENTIAL)
                .build(),
        )
    }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun NewAgentFrame(title: String, root: Boolean, back: (() -> Unit)?, content: @Composable () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, maxLines = 1) },
                navigationIcon = {
                    if (back != null) {
                        IconButton(onClick = back) {
                            if (root) Icon(Icons.Filled.Close, contentDescription = "Close") else Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) { content() }
    }
}

@Composable
internal fun ComputerList(room: RoomView, computers: Loaded<List<ComputerView>>, retry: () -> Unit, pick: (ComputerView) -> Unit) {
    Steps(computers, "Looking for your computers…", retry) { list ->
        if (list.isEmpty()) {
            item { Note("No paired computers yet. Pair one from the Mac app: Settings → Computers.") }
        } else {
            items(list, key = { it.key }) { c ->
                Choice(
                    icon = { Icon(Icons.Outlined.Computer, contentDescription = null) },
                    title = c.name,
                    detail = if (c.online) "Online" else "Offline · seen ${When.short(c.seenAt.toLong())}",
                    detailColor = if (c.online) Tone.current.live else Tone.current.ink3,
                    enabled = c.online,
                ) { pick(c) }
            }
            item { Note("The agent starts on the computer you pick and joins ${room.title}.") }
        }
    }
}

@Composable
internal fun HarnessList(computer: ComputerView, harnesses: Loaded<HarnessesOn>, retry: () -> Unit, pick: (HarnessChoice, Boolean) -> Unit) {
    Steps(harnesses, "Asking ${computer.name}…", retry) { got ->
        if (got.harnesses.isEmpty()) {
            item { Note("Nothing to start on ${computer.name}. Install Claude Code or Codex there, then try again.") }
        } else {
            items(got.harnesses, key = { it.harness }) { h ->
                Choice(
                    icon = { Icon(Icons.Outlined.Terminal, contentDescription = null) },
                    title = h.name,
                    detail = if (h.start) h.version else h.why ?: "Kiwi can't start it yet",
                    enabled = h.start,
                ) { pick(h, got.bypass) }
            }
            item { Note("What's installed on ${computer.name}.") }
        }
    }
}

@Composable
internal fun FolderList(computer: ComputerView, folders: Loaded<List<String>>, retry: () -> Unit, pick: (String) -> Unit) {
    Steps(folders, "Asking ${computer.name}…", retry) { list ->
        if (list.isEmpty()) {
            item { Note("No folders yet. An agent starts where this channel's agents already work on ${computer.name}. Start the first one there from the Mac app.") }
        } else {
            items(list, key = { it }) { folder ->
                Choice(
                    icon = { Icon(Icons.Outlined.Folder, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
                    title = folder.trimEnd('/').substringAfterLast('/'),
                    detail = folder,
                    enabled = true,
                    path = true,
                ) { pick(folder) }
            }
            item { Note("Where this channel's agents work on ${computer.name}.") }
        }
    }
}

private val nameShape = Regex("""^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$""")

@Composable
internal fun OptionsForm(computer: ComputerView, harness: HarnessChoice, bypass: Boolean, folder: String, start: (AgentChoices) -> Unit) {
    val tone = Tone.current
    var nick by remember { mutableStateOf("") }
    var modelName by remember { mutableStateOf("") }
    var effort by remember { mutableStateOf<String?>(null) }
    var permission by remember { mutableStateOf<String?>(null) }
    var context by remember { mutableStateOf<Int?>(null) }
    val options = harness.options
    val modes = options?.permission.orEmpty().filter { it != "default" }
    val nameOk = nick.isBlank() || nameShape.matches(nick.trim())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column {
            Fact("Computer", computer.name)
            Fact("Harness", harness.name)
            Fact("Folder", folder.trimEnd('/').substringAfterLast('/'))
        }
        OutlinedTextField(
            value = nick,
            onValueChange = { nick = it },
            label = { Text("Name") },
            placeholder = { Text("Kiwi picks one") },
            isError = !nameOk,
            supportingText = if (nameOk) {
                null
            } else {
                { Text("Letters and digits, then spaces, _ . or -, up to 40") }
            },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        if (options?.model == true) {
            OutlinedTextField(
                value = modelName,
                onValueChange = { modelName = it },
                label = { Text("Model") },
                placeholder = { Text("${harness.name}'s default") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (options != null && options.effort.isNotEmpty()) Pick("Effort", options.effort, effort, { it.replaceFirstChar(Char::uppercase) }) { effort = it }
        if (modes.isNotEmpty()) Pick("Permissions", modes, permission, ::permissionLabel) { permission = it }
        if (options != null && options.context.isNotEmpty()) Pick("Context", options.context, context, ::tokens) { context = it }
        if (permission == "bypass") {
            Text(
                "The agent runs commands and changes files on ${computer.name} without asking first. You'll confirm with your screen lock.",
                style = MaterialTheme.typography.bodySmall,
                color = tone.decide,
            )
        } else if (!bypass && modes.isNotEmpty()) {
            Text(
                "Bypass is off on ${computer.name}. Turn on Allow bypass from your other devices in its Settings → New agents to start one from here.",
                style = MaterialTheme.typography.bodySmall,
                color = tone.ink3,
            )
        }
        Button(
            onClick = {
                start(
                    AgentChoices(
                        nick = nick.trim().ifEmpty { null },
                        model = modelName.trim().ifEmpty { null },
                        effort = effort,
                        permission = permission,
                        context = context,
                    ),
                )
            },
            enabled = nameOk,
            shape = RoundedCornerShape(26.dp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        ) {
            Text("Start", style = MaterialTheme.typography.titleSmall)
        }
    }
}

@Composable
internal fun StartedList(room: RoomView, computer: ComputerView, harness: HarnessChoice, starting: Starting, seen: LaunchSeen?, retry: () -> Unit, close: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        when (starting) {
            Starting.Sending -> Stage("Asking ${computer.name} to start ${harness.name}", StageState.Busy)
            is Starting.Failed -> {
                Stage("${computer.name} didn't start it", StageState.Failed)
                Text(starting.why, style = MaterialTheme.typography.bodyMedium, color = Tone.current.ink2, modifier = Modifier.padding(start = 40.dp, bottom = 12.dp))
                QuietButton("Try again", action = retry)
            }
            is Starting.Started -> {
                val joined = seen?.stage == "joined"
                Stage("${harness.name} started on ${computer.name}", StageState.Done)
                Stage(seen?.let { "${it.name} asked to join" } ?: "Waiting for it to ask to join", if (seen == null) StageState.Busy else StageState.Done)
                Stage(if (joined) "${seen?.name ?: "It"} is in ${room.title}" else "Letting it in", if (joined) StageState.Done else if (seen == null) StageState.Waiting else StageState.Busy)
                Note(if (joined) "It's working in a terminal on ${computer.name}." else "This takes a few seconds while it starts on ${computer.name}.")
                PrimaryButton("Done", modifier = Modifier.padding(top = 12.dp), action = close)
            }
        }
    }
}

enum class StageState { Waiting, Busy, Done, Failed }

@Composable
private fun Stage(text: String, state: StageState) {
    val tone = Tone.current
    Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
            when (state) {
                StageState.Waiting -> Icon(Icons.Outlined.Circle, contentDescription = null, tint = tone.ink3)
                StageState.Busy -> CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                StageState.Done -> Icon(Icons.Filled.CheckCircle, contentDescription = "Done", tint = tone.live)
                StageState.Failed -> Icon(Icons.Filled.Error, contentDescription = "Failed", tint = tone.alert)
            }
        }
        Text(text, style = MaterialTheme.typography.bodyLarge, color = if (state == StageState.Waiting) tone.ink3 else MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun <T> Steps(loaded: Loaded<T>, waiting: String, retry: () -> Unit, ready: androidx.compose.foundation.lazy.LazyListScope.(T) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(vertical = 8.dp)) {
        when (loaded) {
            Loaded.Loading -> item {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(waiting, style = MaterialTheme.typography.bodyLarge, color = Tone.current.ink2)
                }
            }
            is Loaded.Failed -> item {
                Column(Modifier.padding(16.dp)) {
                    Text(loaded.why, style = MaterialTheme.typography.bodyLarge, color = Tone.current.ink2)
                    TextButton(onClick = retry, contentPadding = PaddingValues(0.dp)) { Text("Try again") }
                }
            }
            is Loaded.Ready -> ready(loaded.value)
        }
    }
}

@Composable
private fun Choice(
    icon: @Composable () -> Unit,
    title: String,
    detail: String?,
    enabled: Boolean,
    detailColor: androidx.compose.ui.graphics.Color = Tone.current.ink3,
    path: Boolean = false,
    tap: () -> Unit,
) {
    ListItem(
        headlineContent = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = if (detail == null) {
            null
        } else {
            { Text(detail, color = detailColor, maxLines = if (path) 1 else 2, overflow = if (path) TextOverflow.StartEllipsis else TextOverflow.Ellipsis) }
        },
        leadingContent = icon,
        colors = ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.clickable(enabled = enabled, onClick = tap).alpha(if (enabled) 1f else 0.5f),
    )
}

@Composable
private fun Note(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = Tone.current.ink3, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyLarge, color = Tone.current.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    HorizontalDivider(color = Tone.current.line)
}

@Composable
private fun <T> Pick(label: String, values: List<T>, chosen: T?, name: (T) -> String, choose: (T?) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = Tone.current.ink2)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(selected = chosen == null, onClick = { choose(null) }, label = { Text("Default") }) }
            items(values.size) { i ->
                val value = values[i]
                FilterChip(selected = chosen == value, onClick = { choose(value) }, label = { Text(name(value)) })
            }
        }
    }
}

private fun permissionLabel(mode: String): String =
    when (mode) {
        "accept-edits" -> "Accept edits"
        "plan" -> "Plan only"
        "bypass" -> "Bypass"
        else -> mode
    }

private fun tokens(n: Int): String =
    when {
        n % 1_000_000 == 0 -> "${n / 1_000_000}M tokens"
        n % 1_000 == 0 -> "${n / 1_000}K tokens"
        else -> "$n tokens"
    }
