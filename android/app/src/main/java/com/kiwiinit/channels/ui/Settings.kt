package com.kiwiinit.channels.ui

import android.content.pm.PackageManager
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Router
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.Tone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(model: AppModel, back: () -> Unit) {
    val tone = Tone.current
    val context = LocalContext.current
    var confirm by remember { mutableStateOf(false) }
    val version = remember {
        try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            "${info.versionName} (${info.longVersionCode})"
        } catch (e: PackageManager.NameNotFoundException) {
            // This app always finds itself; an empty version line is the harmless fallback.
            ""
        }
    }
    val relayHost = Uri.parse(model.relay).host ?: model.relay
    val guarded = when {
        !model.lock.available -> "Off, no screen lock"
        model.lock.biometric -> "Biometrics, after 30 s"
        else -> "Screen lock, after 30 s"
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Face(model.person.ifEmpty { "?" }, null, 80.dp)
                Text(model.person, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                Text("Linked to your Mac", style = MaterialTheme.typography.bodyMedium, color = tone.ink3)
            }
            Section("This phone")
            Group {
                Setting(Icons.Filled.Forum, tone.live, "Channels", "${model.channels.size}")
                Setting(Icons.Filled.Router, tone.doing, "Relay", relayHost)
                Setting(Icons.Filled.Lock, tone.ink3, "Lock", guarded)
            }
            Spacer(Modifier.size(16.dp))
            Group {
                Setting(Icons.Filled.Link, MaterialTheme.colorScheme.primary, "Link again", null) { model.relinkAsked = true }
            }
            Foot("Brings the channels you joined on your Mac since you linked.")
            Spacer(Modifier.size(16.dp))
            Group {
                Text(
                    "Unlink this phone",
                    style = MaterialTheme.typography.bodyLarge,
                    color = tone.alert,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth().clickable { confirm = true }.padding(16.dp),
                )
            }
            Foot("This phone holds your person key and your channels' keys, sealed by its keystore. Unlinking deletes them from this phone.")
            Text(
                "Channels $version",
                style = MaterialTheme.typography.labelMedium,
                color = tone.ink3,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
            )
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Unlink this phone?") },
            text = { Text("Its keys are deleted. Link again from your Mac to come back.") },
            confirmButton = {
                TextButton(onClick = {
                    confirm = false
                    model.unlink()
                }) { Text("Unlink", color = tone.alert) }
            },
            dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } },
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
