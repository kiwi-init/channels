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
import androidx.compose.ui.res.stringResource

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
        Text(stringResource(R.string.channels), style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 28.dp))
        Text(stringResource(R.string.tagline), style = MaterialTheme.typography.bodyLarge, color = tone.ink2, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.size(40.dp))
        when (linking) {
            Linking.Idle, is Linking.Failed -> {
                Text(stringResource(R.string.sign_in), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.sign_in_lead),
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                    modifier = Modifier.padding(top = 6.dp),
                )
                if (linking is Linking.Failed) Text(linking.why, style = MaterialTheme.typography.bodyMedium, color = tone.alert, modifier = Modifier.padding(top = 16.dp))
                PrimaryButton(stringResource(R.string.sign_in), modifier = Modifier.padding(top = 24.dp)) { model.signIn() }
            }
            is Linking.SigningIn -> {
                val url = linking.url
                if (url == null) {
                    Waiting(stringResource(R.string.opening_sign_in))
                } else {
                    Text(stringResource(R.string.sign_in_browser), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(
                        stringResource(R.string.sign_in_browser_lead),
                        style = MaterialTheme.typography.bodyMedium,
                        color = tone.ink2,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    if (linking.code.isNotEmpty()) {
                        Text(stringResource(R.string.check_page_shows), style = MaterialTheme.typography.bodyMedium, color = tone.ink3, modifier = Modifier.padding(top = 24.dp))
                        Text(linking.code, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.sp, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))
                    } else {
                        Spacer(Modifier.size(24.dp))
                    }
                    Waiting(stringResource(R.string.finish_in_browser))
                    QuietButton(stringResource(R.string.open_sign_in_page), Modifier.padding(top = 24.dp)) { model.browse(url) }
                }
                QuietButton(stringResource(R.string.cancel), Modifier.padding(top = 10.dp)) { model.cancelLink() }
            }
            Linking.Asking -> {
                Text(stringResource(R.string.approve_phone), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.approve_phone_lead),
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Spacer(Modifier.size(24.dp))
                Waiting(stringResource(R.string.waiting_computer))
                QuietButton(stringResource(R.string.cancel), Modifier.padding(top = 24.dp)) { model.cancelLink() }
            }
            is Linking.Approve -> {
                Text(stringResource(R.string.approve_phone), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    stringResource(R.string.approve_digits_lead),
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
                Waiting(stringResource(R.string.waiting_computer))
                QuietButton(stringResource(R.string.cancel), Modifier.padding(top = 24.dp)) { model.cancelLink() }
            }
            is Linking.Check -> {
                var keeping by remember(linking) { mutableStateOf(false) }
                Text(stringResource(R.string.key_check_title, linking.name), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    linking.fingerprint,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.padding(vertical = 20.dp),
                )
                Text(
                    stringResource(R.string.key_check_lead),
                    style = MaterialTheme.typography.bodyMedium,
                    color = tone.ink2,
                )
                PrimaryButton(stringResource(R.string.key_matches), busy = keeping, modifier = Modifier.padding(top = 24.dp)) {
                    keeping = true
                    model.keepLink()
                }
                QuietButton(stringResource(R.string.key_differs), Modifier.padding(top = 10.dp)) { if (!keeping) model.refuseLink(linking.fingerprint) }
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
