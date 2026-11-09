package com.kiwiinit.channels.ui

import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Language as LanguageIcon
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Router
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.RadioButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.kiwiinit.channels.R
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Language
import com.kiwiinit.channels.theme.Tone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppModel) {
    val tone = Tone.current
    val context = LocalContext.current
    var confirm by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf(false) }
    val chosen = remember { Language.chosen(context) }
    val system = stringResource(R.string.language_system)
    val languageName = Language.choices.firstOrNull { it.first.equals(chosen, ignoreCase = true) }?.second ?: system
    val version = remember {
        try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            "${info.versionName} (${info.longVersionCode})"
        } catch (e: PackageManager.NameNotFoundException) {
            // This app always finds itself; an empty version line is the harmless fallback.
            ""
        }
    }
    val relayHost = model.relay.toUri().host ?: model.relay
    val guarded = when {
        !model.lock.available -> stringResource(R.string.lock_off)
        model.lock.biometric -> stringResource(R.string.lock_biometric)
        else -> stringResource(R.string.lock_screen)
    }
    Scaffold(
        topBar = { BigTitle(stringResource(R.string.tab_you)) },
        contentWindowInsets = WindowInsets(0),
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Face(model.person.ifEmpty { "?" }, null, 80.dp)
                Text(model.person, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                Text(if (model.enrolled) stringResource(R.string.signed_in_device) else stringResource(R.string.linked_to_mac), style = MaterialTheme.typography.bodyMedium, color = tone.ink3)
            }
            Section(stringResource(R.string.this_phone))
            Group {
                Setting(Icons.Filled.Forum, tone.live, stringResource(R.string.channels), "${model.channels.size}")
                Setting(Icons.Filled.Router, tone.doing, stringResource(R.string.relay), relayHost)
                Setting(Icons.Filled.Lock, tone.ink3, stringResource(R.string.lock), guarded)
                Setting(Icons.Filled.LanguageIcon, MaterialTheme.colorScheme.primary, stringResource(R.string.language), languageName) { picking = true }
            }
            if (!model.enrolled) {
                Spacer(Modifier.size(16.dp))
                Group {
                    Setting(Icons.Filled.Link, MaterialTheme.colorScheme.primary, stringResource(R.string.link_again), null) { model.relinkAsked = true }
                }
                Foot(stringResource(R.string.link_again_foot))
            }
            Spacer(Modifier.size(16.dp))
            Group {
                Text(
                    if (model.enrolled) stringResource(R.string.sign_out_phone) else stringResource(R.string.unlink_phone),
                    style = MaterialTheme.typography.bodyLarge,
                    color = tone.alert,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clickable { confirm = true }.padding(16.dp),
                )
            }
            Foot(
                if (model.enrolled) {
                    stringResource(R.string.keys_foot_enrolled)
                } else {
                    stringResource(R.string.keys_foot_linked)
                },
            )
            Text(
                stringResource(R.string.version_line, version),
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
            )
        }
    }
    if (picking) {
        AlertDialog(
            onDismissRequest = { picking = false },
            title = { Text(stringResource(R.string.language)) },
            text = {
                Column {
                    for ((tag, name) in listOf("" to system) + Language.choices) {
                        val on = tag.equals(chosen, ignoreCase = true)
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable {
                                picking = false
                                context.activity()?.let { Language.choose(it, tag) }
                            }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = on, onClick = null)
                            Spacer(Modifier.width(12.dp))
                            Text(name, style = MaterialTheme.typography.bodyLarge)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text(if (model.enrolled) stringResource(R.string.sign_out_q) else stringResource(R.string.unlink_q)) },
            text = { Text(if (model.enrolled) stringResource(R.string.sign_out_body) else stringResource(R.string.unlink_body)) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    model.unlink()
                }) { Text(if (model.enrolled) stringResource(R.string.sign_out) else stringResource(R.string.unlink), color = tone.alert) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text(stringResource(R.string.cancel)) } },
        )
    }
}

@Composable
private fun Section(title: String) {
    Text(title, style = MaterialTheme.typography.labelLarge, color = Tone.current.ink3, modifier = Modifier.padding(start = 32.dp, top = 16.dp, bottom = 8.dp))
}

@Composable
private fun Foot(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = Tone.current.ink3, modifier = Modifier.padding(start = 32.dp, end = 32.dp, top = 8.dp))
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) {
        content()
    }
}

@Composable
private fun Setting(icon: ImageVector, tint: Color, title: String, value: String?, tap: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (tap != null) Modifier.clickable(onClick = tap) else Modifier).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(32.dp).clip(RoundedCornerShape(9.dp)).background(tint), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.width(14.dp))
        Text(title, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, style = MaterialTheme.typography.bodyMedium, color = Tone.current.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 12.dp))
        }
    }
}
