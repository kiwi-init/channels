package com.kiwiinit.channels.ui

import android.graphics.BitmapFactory
import android.os.Build
import android.text.format.DateFormat
import android.util.Base64
import android.util.LruCache
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Terminal
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kiwiinit.channels.R
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.model.Buzz
import com.kiwiinit.channels.model.Row
import com.kiwiinit.channels.model.RowKind
import com.kiwiinit.channels.theme.Palette
import com.kiwiinit.channels.theme.Tone
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.util.Locale

val robots: Map<String, Int> = mapOf(
    "blue" to R.drawable.robot_blue,
    "coral" to R.drawable.robot_coral,
    "gold" to R.drawable.robot_gold,
    "lilac" to R.drawable.robot_lilac,
    "lime" to R.drawable.robot_lime,
    "mint" to R.drawable.robot_mint,
    "orange" to R.drawable.robot_orange,
    "pink" to R.drawable.robot_pink,
    "purple" to R.drawable.robot_purple,
    "red" to R.drawable.robot_red,
    "sky" to R.drawable.robot_sky,
    "teal" to R.drawable.robot_teal,
)

val harnesses: Map<String, Int> = mapOf(
    "claude-code" to R.drawable.harness_claude_code,
    "codex" to R.drawable.harness_codex,
    "cursor" to R.drawable.harness_cursor,
    "gemini" to R.drawable.harness_gemini,
    "grok" to R.drawable.harness_grok,
    "grok-bot" to R.drawable.harness_grok_bot,
    "kimi-code" to R.drawable.harness_kimi_code,
    "mimocode" to R.drawable.harness_mimocode,
    "opencode" to R.drawable.harness_opencode,
    "pi" to R.drawable.harness_pi,
    "zcode" to R.drawable.harness_zcode,
)

fun View.buzz(kind: Buzz) {
    val constant = when (kind) {
        Buzz.Tap -> HapticFeedbackConstants.CLOCK_TICK
        Buzz.Warn -> HapticFeedbackConstants.LONG_PRESS
        Buzz.Fail -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
        Buzz.Done -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
    }
    performHapticFeedback(constant)
}

@Composable
fun Face(name: String, member: MemberView?, size: Dp = 32.dp, modifier: Modifier = Modifier) {
    val tone = Tone.current
    Box(modifier.size(size).clearAndSetSemantics {}) {
        if (member?.isAgent == true) {
            Box(
                Modifier.fillMaxSize().clip(CircleShape).background(Brush.verticalGradient(listOf(tone.faceTop, tone.faceBottom))),
                contentAlignment = Alignment.Center,
            ) {
                val art = member.harness?.let { harnesses[it] }
                if (art != null) {
                    Image(
                        painter = painterResource(art),
                        contentDescription = null,
                        modifier = Modifier.size(size * 0.56f),
                        colorFilter = if (member.mono) ColorFilter.tint(MaterialTheme.colorScheme.onSurface) else null,
                    )
                } else {
                    Icon(Icons.Filled.Terminal, contentDescription = null, tint = tone.ink2, modifier = Modifier.size(size * 0.48f))
                }
            }
            if (member.working) {
                val dot = maxOf(8.dp, size * 0.28f)
                Box(
                    Modifier.align(Alignment.TopEnd)
                        .offset(x = 1.dp, y = (-1).dp)
                        .size(dot)
                        .clip(CircleShape)
                        .background(tone.doing)
                        .border(2.dp, MaterialTheme.colorScheme.surface, CircleShape),
                )
            }
        } else {
            val fill = member?.color?.let { Palette.fills[it] }
            val top = fill?.let { Color(it.first) } ?: tone.avatarTop
            val bottom = fill?.let { lerp(Color(it.first), Color.Black, 0.28f) } ?: tone.avatarBottom
            val ink = fill?.let { Color(it.second) } ?: Color.White
            val letters = initials(member?.display ?: name)
            Box(
                Modifier.fillMaxSize().clip(CircleShape).background(Brush.verticalGradient(listOf(top, bottom))),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    letters,
                    color = ink,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = (size.value * (if (letters.length > 1) 0.4f else 0.46f)).sp,
                    maxLines = 1,
                )
            }
        }
    }
}

private fun initials(name: String): String {
    val words = name.split(' ', '-', '_', '.').filter { it.isNotEmpty() }
    val letters = words.take(2).joinToString("") { it.first().uppercase() }
    return letters.ifEmpty { "?" }
}

private val icons = LruCache<String, ImageBitmap>(16)

private fun picture(room: RoomView): ImageBitmap? {
    val data = room.icon?.data ?: return null
    val key = "${room.code}|${data.length}|${data.takeLast(32)}"
    icons.get(key)?.let { return it }
    val raw = try {
        Base64.decode(data, Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
        // A garbled picture falls back to the robot head.
        return null
    }
    val image = BitmapFactory.decodeByteArray(raw, 0, raw.size)?.asImageBitmap() ?: return null
    icons.put(key, image)
    return image
}

@Composable
fun ChannelAvatar(room: RoomView, size: Dp = 50.dp, modifier: Modifier = Modifier) {
    val tone = Tone.current
    val icon = room.icon
    val image = if (icon?.kind == "image") picture(room) else null
    val emoji = if (icon != null && icon.kind == "emoji") icon.emoji else null
    Box(modifier.size(size).clip(CircleShape).clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
        when {
            image != null -> Image(image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().background(tone.wash2))
            emoji != null -> Box(Modifier.fillMaxSize().background(tone.wash2), contentAlignment = Alignment.Center) {
                Text(emoji, fontSize = (size.value * 0.5f).sp)
            }
            else -> Image(
                painter = painterResource(robots[icon?.robot ?: "blue"] ?: R.drawable.robot_blue),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
fun RowAvatar(row: Row, size: Dp = 52.dp) {
    val tone = Tone.current
    val ring = MaterialTheme.colorScheme.surface
    Box(Modifier.size(size)) {
        when (row.kind) {
            RowKind.Group -> {
                ChannelAvatar(row.room, size)
                if (row.working) {
                    Box(
                        Modifier.align(Alignment.TopEnd)
                            .size(size * 0.26f)
                            .clip(CircleShape)
                            .background(tone.doing)
                            .border(2.dp, ring, CircleShape),
                    )
                }
            }
            RowKind.Lead -> Face(row.lead ?: row.title, row.lead?.let { row.room.member(it) }, size)
        }
        if (row.kind != RowKind.Group && row.qualifier != null && size >= 44.dp) {
            ChannelAvatar(
                row.room,
                size * 0.4f,
                Modifier.align(Alignment.BottomEnd).offset(x = 3.dp, y = 3.dp).border(2.dp, ring, CircleShape),
            )
        }
    }
}

@Composable
fun Dot(color: Color, size: Dp = 6.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

@Composable
fun PrimaryButton(title: String, busy: Boolean = false, modifier: Modifier = Modifier, action: () -> Unit) {
    Button(
        onClick = action,
        enabled = !busy,
        modifier = modifier.fillMaxWidth().heightIn(min = 52.dp),
        shape = RoundedCornerShape(26.dp),
        colors = ButtonDefaults.buttonColors(),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        } else {
            Text(title, style = MaterialTheme.typography.titleSmall)
        }
    }
}

@Composable
fun QuietButton(title: String, modifier: Modifier = Modifier, action: () -> Unit) {
    OutlinedButton(onClick = action, modifier = modifier.fillMaxWidth().heightIn(min = 52.dp), shape = RoundedCornerShape(26.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
    }
}

@Composable
fun Centered(title: String, detail: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        Text(
            detail,
            style = MaterialTheme.typography.bodyMedium,
            color = Tone.current.ink2,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 6.dp),
        )
    }
}

object When {
    private val zone: ZoneId get() = ZoneId.systemDefault()
    private val locale: Locale get() = Locale.getDefault()

    private fun day(millis: Long): LocalDate = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()

    private fun pattern(skeleton: String): DateTimeFormatter = DateTimeFormatter.ofPattern(DateFormat.getBestDateTimePattern(locale, skeleton), locale)

    fun clock(millis: Long): String = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(Instant.ofEpochMilli(millis).atZone(zone))

    fun short(millis: Long, now: Long = System.currentTimeMillis()): String {
        val s = (now - millis) / 1000
        if (s < 60) return "now"
        if (s < 3600) return "${s / 60}m"
        val date = day(millis)
        val today = day(now)
        if (date == today) return clock(millis)
        if (ChronoUnit.DAYS.between(date, today) < 6) return pattern("EEE").format(Instant.ofEpochMilli(millis).atZone(zone))
        return pattern("MMMd").format(Instant.ofEpochMilli(millis).atZone(zone))
    }

    fun dayWord(millis: Long, now: Long = System.currentTimeMillis()): String {
        val date = day(millis)
        val today = day(now)
        if (date == today) return "Today"
        if (date == today.minusDays(1)) return "Yesterday"
        if (ChronoUnit.DAYS.between(date, today) < 6) return pattern("EEEE").format(Instant.ofEpochMilli(millis).atZone(zone))
        return pattern("yMMMd").format(Instant.ofEpochMilli(millis).atZone(zone))
    }

    fun list(millis: Long, now: Long = System.currentTimeMillis()): String {
        val date = day(millis)
        val today = day(now)
        if (date == today) return clock(millis)
        if (date == today.minusDays(1)) return "Yesterday"
        if (ChronoUnit.DAYS.between(date, today) < 6) return pattern("EEE").format(Instant.ofEpochMilli(millis).atZone(zone))
        if (date.year == today.year) return pattern("MMMd").format(Instant.ofEpochMilli(millis).atZone(zone))
        return pattern("yMd").format(Instant.ofEpochMilli(millis).atZone(zone))
    }

    fun sameDay(a: Long, b: Long): Boolean = day(a) == day(b)
}
