package com.kiwiinit.channels.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Immutable
data class Tones(
    val dark: Boolean,
    val decide: Color,
    val decideWash: Color,
    val live: Color,
    val doing: Color,
    val alert: Color,
    val mine: Color,
    val onMine: Color,
    val them: Color,
    val onThem: Color,
    val faceTop: Color,
    val faceBottom: Color,
    val avatarTop: Color,
    val avatarBottom: Color,
    val wash: Color,
    val wash2: Color,
    val line: Color,
    val ink2: Color,
    val ink3: Color,
)

val LocalTones = staticCompositionLocalOf { tones(lightScheme, false) }

object Tone {
    val current: Tones
        @Composable get() = LocalTones.current
}

object Palette {
    val fills: Map<String, Pair<Long, Long>> = mapOf(
        "red" to (0xFFF0605DL to 0xFFFFFFFFL),
        "orange" to (0xFFFF9A3CL to 0xFFFFFFFFL),
        "yellow" to (0xFFF5C542L to 0xFF1A1A1AL),
        "green" to (0xFF3FBF74L to 0xFFFFFFFFL),
        "teal" to (0xFF2FB8B0L to 0xFFFFFFFFL),
        "blue" to (0xFF4A8DF0L to 0xFFFFFFFFL),
        "indigo" to (0xFF6F74F2L to 0xFFFFFFFFL),
        "violet" to (0xFF9A63F0L to 0xFFFFFFFFL),
        "pink" to (0xFFF2559AL to 0xFFFFFFFFL),
        "brown" to (0xFFB08463L to 0xFFFFFFFFL),
    )
}

object Radius {
    val bubble = 20.dp
    val joined = 6.dp
    val card = 16.dp
    val ctl = 12.dp
    val dock = 26.dp
}

private val lightScheme = lightColorScheme(
    primary = Color(0xFF0B57D0),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFD3E3FD),
    onPrimaryContainer = Color(0xFF041E49),
    secondaryContainer = Color(0xFFC2E7FF),
    onSecondaryContainer = Color(0xFF001D35),
    surface = Color(0xFFFFFFFF),
    surfaceContainerLowest = Color(0xFFFFFFFF),
    surfaceContainerLow = Color(0xFFF8FAFD),
    surfaceContainer = Color(0xFFF0F4F9),
    surfaceContainerHigh = Color(0xFFE9EEF6),
    surfaceContainerHighest = Color(0xFFDDE3EA),
)

private val darkScheme = darkColorScheme(
    primary = Color(0xFFA8C7FA),
    onPrimary = Color(0xFF062E6F),
    primaryContainer = Color(0xFF0842A0),
    onPrimaryContainer = Color(0xFFD3E3FD),
    secondaryContainer = Color(0xFF004A77),
    onSecondaryContainer = Color(0xFFC2E7FF),
    surface = Color(0xFF131314),
    surfaceContainerLowest = Color(0xFF0E0E0E),
    surfaceContainerLow = Color(0xFF1B1B1B),
    surfaceContainer = Color(0xFF1E1F20),
    surfaceContainerHigh = Color(0xFF282A2C),
    surfaceContainerHighest = Color(0xFF333537),
)

private fun tones(scheme: ColorScheme, dark: Boolean): Tones =
    if (dark) {
        Tones(
            dark = true,
            decide = Color(0xFFF5B041),
            decideWash = Color(0x24F5B041),
            live = Color(0xFF32D074),
            doing = Color(0xFF5B9BFF),
            alert = Color(0xFFFF6259),
            mine = scheme.primaryContainer,
            onMine = scheme.onPrimaryContainer,
            them = scheme.surfaceContainerHigh,
            onThem = scheme.onSurface,
            faceTop = Color(0xFF323236),
            faceBottom = Color(0xFF26262A),
            avatarTop = Color(0xFF78787F),
            avatarBottom = Color(0xFF55555C),
            wash = Color(0x0EFFFFFF),
            wash2 = Color(0x17FFFFFF),
            line = Color(0x14FFFFFF),
            ink2 = scheme.onSurfaceVariant,
            ink3 = scheme.onSurfaceVariant.copy(alpha = 0.78f),
        )
    } else {
        Tones(
            dark = false,
            decide = Color(0xFFA35A00),
            decideWash = Color(0x1FD67D00),
            live = Color(0xFF1F9A55),
            doing = Color(0xFF2F6FE4),
            alert = Color(0xFFD1342A),
            mine = scheme.primaryContainer,
            onMine = scheme.onPrimaryContainer,
            them = scheme.surfaceContainerHigh,
            onThem = scheme.onSurface,
            faceTop = Color(0xFFF2F2F4),
            faceBottom = Color(0xFFE4E4E8),
            avatarTop = Color(0xFFA8A8B0),
            avatarBottom = Color(0xFF8A8A92),
            wash = Color(0x0B0F0F11),
            wash2 = Color(0x130F0F11),
            line = Color(0x140F0F11),
            ink2 = scheme.onSurfaceVariant,
            ink3 = scheme.onSurfaceVariant.copy(alpha = 0.82f),
        )
    }

@Composable
fun ChannelsTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> darkScheme
        else -> lightScheme
    }
    CompositionLocalProvider(LocalTones provides tones(scheme, dark)) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
