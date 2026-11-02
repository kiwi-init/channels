package com.kiwiinit.channels.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.PanTool
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Attached
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.JPEG_FLOOR
import com.kiwiinit.channels.model.MAX_IMAGE_BYTES
import com.kiwiinit.channels.model.WEBP_FLOOR
import com.kiwiinit.channels.model.capped
import com.kiwiinit.channels.model.fitImage
import com.kiwiinit.channels.model.Draft
import com.kiwiinit.channels.model.Outgoing
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.oneLine
import com.kiwiinit.channels.model.taskLabel
import com.kiwiinit.channels.theme.Tone
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PREVIEW_SIDE = 512

private suspend fun shrink(context: Context, uri: Uri): Attached? =
    withContext(Dispatchers.IO) {
        try {
            val source = ImageDecoder.createSource(context.contentResolver, uri)
            val full = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
                val (w, h) = capped(info.size.width, info.size.height)
                decoder.setTargetSize(w, h)
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
            val webp = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            val format = if (webp) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.JPEG
            var drawn = full
            val fit = fitImage(full.width, full.height, MAX_IMAGE_BYTES, if (webp) WEBP_FLOOR else JPEG_FLOOR) { w, h, quality ->
                if (drawn.width != w || drawn.height != h) drawn = Bitmap.createScaledBitmap(full, w, h, true)
                val out = ByteArrayOutputStream()
                if (drawn.compress(format, quality, out)) out.toByteArray() else null
            } ?: return@withContext null
            val thumb = PREVIEW_SIDE.toFloat() / maxOf(drawn.width, drawn.height)
            val preview = if (thumb < 1f) Bitmap.createScaledBitmap(drawn, maxOf(1, (drawn.width * thumb).toInt()), maxOf(1, (drawn.height * thumb).toInt()), true) else drawn
            Attached(UUID.randomUUID().toString(), preview.asImageBitmap(), fit.bytes, if (webp) "image/webp" else "image/jpeg")
        } catch (e: IOException) {
            // A file the decoder can't read isn't attached; the others still are.
            null
        }
    }

private val mentioning = Regex("""(?:^|\s)@([^\s@]*)$""")

@Composable
fun Dock(
    model: AppModel,
    room: RoomView,
    spot: Spot,
    replyTo: MessageView?,
    answering: AskView?,
    sendingBack: ReviewView?,
    focus: FocusRequester,
    clearReply: () -> Unit,
    clearAnswer: () -> Unit,
    clearSendBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tone = Tone.current
    val view = LocalView.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var value by remember { mutableStateOf(TextFieldValue("")) }
    var attached by remember { mutableStateOf<List<Attached>>(emptyList()) }
    var sending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val current by rememberUpdatedState(spot)

    DisposableEffect(spot) {
        val kept = model.draft(spot)
        value = TextFieldValue(kept.text, TextRange(kept.text.length))
        attached = kept.attached
        error = null
        onDispose { model.keep(Draft(value.text, attached), spot) }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(4)) { uris ->
        scope.launch {
            for (uri in uris) shrink(context, uri)?.let { attached = attached + it }
        }
    }

    val hasText = value.text.isNotBlank()
    val canSend = !sending && room.connection == Connection.Live && (hasText || attached.isNotEmpty())
    val here = room.placeView(spot.place)
    val mention = mentioning.find(value.text)?.groupValues?.get(1)?.lowercase()
    val mentionable = if (mention == null) {
        emptyList()
    } else {
        room.members.filter { it.name != room.me && (it.name.lowercase().startsWith(mention) || it.display.lowercase().startsWith(mention)) }
    }
    val placeholder = when {
        room.connection != Connection.Live -> "Connecting…"
        sendingBack != null -> "What to change"
        replyTo != null -> "Reply to ${room.display(replyTo.from)}"
        answering != null -> "Answer ${room.display(answering.from)}"
        here != null && here.kind == "dm" && room.other(here) != null -> "Message ${room.display(room.other(here) ?: "")}"
        else -> "Message"
    }

    fun complete(name: String) {
        val word = mentioning.find(value.text)?.groupValues?.get(1) ?: return
        val text = value.text.dropLast(word.length + 1) + "@$name "
        value = TextFieldValue(text, TextRange(text.length))
        view.buzz(Buzz.Tap)
    }

    fun send() {
        val text = value.text.trim()
        if (!canSend) return
        if (attached.isEmpty() && answering == null && sendingBack == null) {
            model.post(spot, text, replyTo?.seq)
            value = TextFieldValue("")
            clearReply()
            error = null
            view.buzz(Buzz.Tap)
            return
        }
        sending = true
        error = null
        view.buzz(Buzz.Tap)
        val from = spot
        val ask = answering
        val review = sendingBack
        val re = replyTo?.seq
        val pictures = attached.mapIndexed { i, a -> Outgoing("photo-${i + 1}.${if (a.mime == "image/webp") "webp" else "jpg"}", a.mime, Base64.encodeToString(a.data, Base64.NO_WRAP)) }
        scope.launch {
            try {
                if (pictures.isEmpty() && review != null) {
                    model.sendBack(from.code, review.task, text)
                    clearSendBack()
                } else if (pictures.isEmpty() && ask != null) {
                    model.answer(from.code, ask.seq, text)
                    clearAnswer()
                } else {
                    model.send(from, text, re, pictures)
                }
                if (current == from) {
                    if (value.text.trim() == text) value = TextFieldValue("")
                    attached = emptyList()
                    clearReply()
                } else {
                    model.keep(Draft(), from)
                }
            } catch (e: EngineException) {
                error = e.message
                view.buzz(Buzz.Fail)
            }
            sending = false
        }
    }

    Column(modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 6.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        error?.let {
            Text("Not sent: $it", style = MaterialTheme.typography.labelMedium, color = tone.alert, modifier = Modifier.padding(horizontal = 8.dp))
        }
        if (mentionable.isNotEmpty()) Mentions(mentionable) { complete(it) }
        if (sendingBack != null) {
            Bar(Icons.AutoMirrored.Filled.Reply, tone.decide, "Send back ${taskLabel(sendingBack.task)}", sendingBack.title, clearSendBack)
        } else if (answering != null) {
            Bar(Icons.Filled.PanTool, tone.decide, room.display(answering.from), answering.plain, clearAnswer)
        } else if (replyTo != null) {
            Bar(Icons.AutoMirrored.Filled.Reply, MaterialTheme.colorScheme.primary, room.display(replyTo.from), replyTo.plain, clearReply)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilledTonalIconButton(
                onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                modifier = Modifier.size(48.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = "Add photos")
            }
            Column(
                Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surfaceContainerHigh),
            ) {
                if (attached.isNotEmpty()) {
                    LazyRow(contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        items(attached, key = { it.id }) { a ->
                            Box(Modifier.size(64.dp).clip(RoundedCornerShape(12.dp))) {
                                Image(a.image, contentDescription = "Attached photo", contentScale = ContentScale.Crop, modifier = Modifier.size(64.dp))
                                Box(
                                    Modifier.align(Alignment.TopEnd)
                                        .padding(3.dp)
                                        .size(20.dp)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = 0.55f))
                                        .clickable { attached = attached.filter { it.id != a.id } },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(Icons.Filled.Cancel, contentDescription = "Remove", tint = Color.White, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
                Row(verticalAlignment = Alignment.Bottom) {
                    BasicTextField(
                        value = value,
                        onValueChange = { value = it },
                        modifier = Modifier.weight(1f).padding(start = 18.dp, end = 8.dp, top = 13.dp, bottom = 13.dp).focusRequester(focus),
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                        maxLines = 6,
                        decorationBox = { inner ->
                            Box {
                                if (value.text.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = tone.ink3, maxLines = 1)
                                inner()
                            }
                        },
                    )
                    AnimatedVisibility(visible = canSend || sending, enter = scaleIn() + fadeIn(), exit = scaleOut() + fadeOut()) {
                        FilledIconButton(
                            onClick = { send() },
                            enabled = canSend,
                            modifier = Modifier.padding(end = 6.dp, bottom = 6.dp).size(36.dp),
                            colors = IconButtonDefaults.filledIconButtonColors(),
                        ) {
                            if (sending) {
                                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                            } else {
                                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", modifier = Modifier.size(18.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Mentions(members: List<MemberView>, pick: (String) -> Unit) {
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(horizontal = 4.dp)) {
        items(members, key = { it.name }) { m ->
            Row(
                Modifier.clip(RoundedCornerShape(20.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable { pick(m.name) }
                    .padding(start = 6.dp, end = 12.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Face(m.name, m, 24.dp)
                Text(m.display, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun Bar(icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, who: String, body: String, cancel: () -> Unit) {
    val tone = Tone.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(MaterialTheme.colorScheme.surfaceContainer).padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(14.dp))
        Text(
            buildAnnotatedString {
                withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("$who: ") }
                append(body.oneLine())
            },
            style = MaterialTheme.typography.labelLarge,
            color = tone.ink2,
            maxLines = 1,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = cancel) { Icon(Icons.Filled.Cancel, contentDescription = "Cancel", tint = tone.ink3) }
    }
}
