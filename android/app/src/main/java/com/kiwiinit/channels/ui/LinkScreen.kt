package com.kiwiinit.channels.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kiwiinit.channels.R
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Linking
import com.kiwiinit.channels.theme.Tone

@Composable
fun LinkScreen(model: AppModel, modifier: Modifier = Modifier, linking: Linking = model.linking) {
    val tone = Tone.current
    Column(
        modifier.fillMaxSize()
            .background(MaterialTheme.colorScheme.surface)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Spacer(Modifier.size(40.dp))
        Image(
            painterResource(R.drawable.mark),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)),
        )
        Text("Channels", style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 28.dp))
        Text("Your agents, on your phone.", style = MaterialTheme.typography.bodyLarge, color = tone.ink2, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.size(40.dp))
        when (linking) {
            Linking.Idle, is Linking.Failed -> {
                Text("Sign in", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "With the account Channels on your computer uses, then approve this phone there.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                    modifier = Modifier.padding(top = 6.dp),
                )
                if (linking is Linking.Failed) Text(linking.why, style = MaterialTheme.typography.bodyMedium, color = tone.alert, modifier = Modifier.padding(top = 16.dp))
                PrimaryButton("Sign in", modifier = Modifier.padding(top = 24.dp)) { model.signIn() }
            }
            is Linking.SigningIn -> {
                val url = linking.url
                if (url == null) {
                    Waiting("Opening the sign-in…")
                } else {
                    Text("Sign in in your browser", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(
                        "Use the account Channels on your computer uses.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = tone.ink2,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    if (linking.code.isNotEmpty()) {
                        Text("Check the page shows", style = MaterialTheme.typography.bodyMedium, color = tone.ink3, modifier = Modifier.padding(top = 24.dp))
                        Text(linking.code, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))
                    } else {
                        Spacer(Modifier.size(24.dp))
                    }
                    Waiting("Finish signing in in your browser")
                    QuietButton("Open the sign-in page", Modifier.padding(top = 24.dp)) { model.browse(url) }
                }
                QuietButton("Cancel", Modifier.padding(top = 10.dp)) { model.cancelLink() }
            }
            Linking.Asking -> {
                Text("Approve this phone", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "Open Channels on your computer and let this phone in. It then shows digits to type there.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Spacer(Modifier.size(24.dp))
                Waiting("Waiting for your computer")
                QuietButton("Cancel", Modifier.padding(top = 24.dp)) { model.cancelLink() }
            }
            is Linking.Approve -> {
                Text("Approve this phone", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "Open Channels on your computer. When it asks about this phone, type these digits there.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    spaced(linking.digits),
                    fontSize = 44.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 2.sp,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
                Waiting("Waiting for your computer")
                QuietButton("Cancel", Modifier.padding(top = 24.dp)) { model.cancelLink() }
            }
            is Linking.Check -> {
                var keeping by remember(linking) { mutableStateOf(false) }
                Text("Is this your key, ${linking.name}?", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    linking.fingerprint,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.padding(vertical = 20.dp),
                )
                Text(
                    "Your computer shows it in its approval and in Settings, under Your key for new devices. Join only if they match: a different key means someone else answered this phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                )
                PrimaryButton("It matches, join", busy = keeping, modifier = Modifier.padding(top = 24.dp)) {
                    keeping = true
                    model.keepLink()
                }
                QuietButton("It doesn't match", Modifier.padding(top = 10.dp)) { if (!keeping) model.refuseLink(linking.fingerprint) }
            }
        }
        Spacer(Modifier.size(24.dp))
    }
}

@Composable
private fun Waiting(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(8.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = Tone.current.ink3)
    }
}

private fun spaced(digits: String): String = if (digits.length == 6) "${digits.take(3)} ${digits.takeLast(3)}" else digits
