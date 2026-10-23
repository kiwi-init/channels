package com.kiwiinit.channels.ui

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.kiwiinit.channels.R
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Linking
import com.kiwiinit.channels.theme.Tone

private const val SCHEME = "kiwi://link/"

fun linkCode(text: String): String? {
    val trimmed = text.trim()
    val code = if (trimmed.startsWith(SCHEME)) trimmed.removePrefix(SCHEME) else trimmed
    return code.takeIf { it.startsWith("kl1-") }
}

private fun scan(context: Context, found: (String) -> Unit, failed: (String) -> Unit) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options)
        .startScan()
        .addOnSuccessListener { barcode ->
            val code = barcode.rawValue?.let(::linkCode)
            if (code != null) found(code) else failed("That code isn't a link code from the Channels app on your Mac.")
        }
        .addOnFailureListener { failed("The scanner didn't open (it needs Google Play services). Copy the code on your Mac and paste it instead.") }
}

@Composable
fun LinkScreen(model: AppModel, modifier: Modifier = Modifier) {
    val tone = Tone.current
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var problem by remember { mutableStateOf<String?>(null) }
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
        when (val linking = model.linking) {
            Linking.Idle, is Linking.Failed -> {
                Text("Link this phone", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Step(1, "Open Channels on your Mac.")
                    Step(2, "Settings → Phone → Link a phone.")
                    Step(3, "Scan the code it shows.")
                }
                val why = (linking as? Linking.Failed)?.why ?: problem
                if (why != null) Text(why, style = MaterialTheme.typography.bodyMedium, color = tone.alert, modifier = Modifier.padding(top = 16.dp))
                Column(Modifier.padding(top = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("Scan the code") {
                        problem = null
                        scan(context, found = { model.link(it) }, failed = { problem = it })
                    }
                    QuietButton("Paste the code") {
                        val code = clipboard.getText()?.text?.let(::linkCode)
                        if (code == null) {
                            problem = "The clipboard doesn't hold a link code. Copy it from Link a phone on your Mac."
                        } else {
                            problem = null
                            model.link(code)
                        }
                    }
                }
            }
            Linking.Asking -> Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text("Asking your Mac…", style = MaterialTheme.typography.bodyLarge, color = tone.ink2)
            }
            is Linking.Digits -> {
                Text("Check the code", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Text(
                    "Your Mac shows six digits too. When they match, press It matches on the Mac.",
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(8.dp))
                    Text("Waiting for your Mac", style = MaterialTheme.typography.bodyMedium, color = tone.ink3)
                }
                QuietButton("Cancel", Modifier.padding(top = 24.dp)) { model.cancelLink() }
            }
        }
        Spacer(Modifier.size(24.dp))
    }
}

@Composable
private fun Step(n: Int, text: String) {
    Row(Modifier.fillMaxWidth()) {
        Text("$n", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = Tone.current.ink3, modifier = Modifier.width(18.dp))
        Text(text, style = MaterialTheme.typography.bodyLarge)
    }
}

private fun spaced(digits: String): String = if (digits.length == 6) "${digits.take(3)} ${digits.takeLast(3)}" else digits
