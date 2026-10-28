package com.kiwiinit.channels.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.AwaitPointerEventScope
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.model.Buzz
import com.swmansion.enriched.markdown.CodeBlockLayout
import com.swmansion.enriched.markdown.MarkdownOptions
import com.swmansion.enriched.markdown.compose.EnrichedMarkdownText
import com.swmansion.enriched.markdown.compose.MarkdownStyle
import com.swmansion.enriched.markdown.compose.material3.materialMarkdownStyle
import com.swmansion.enriched.markdown.compose.patches.TextStyleScope
import com.swmansion.enriched.markdown.parser.Md4cFlags
import com.swmansion.enriched.markdown.parser.Parser

class Renderer(private val load: () -> Boolean, private val parse: (String) -> Any?) {
    private val loaded: Boolean by lazy { runCatching(load).getOrDefault(false) }

    fun native(text: String, maxLines: Int = Int.MAX_VALUE): Boolean =
        maxLines == Int.MAX_VALUE && loaded && runCatching { parse(text) != null }.getOrDefault(false)

    companion object {
        private val flags = Md4cFlags(underline = false, latexMath = false, permissiveAutolinks = true, hardSoftBreaks = true)

        val device = Renderer(
            load = {
                System.loadLibrary("enriched_markdown_parser")
                true
            },
            parse = { Parser.shared.parseMarkdown(it, flags) },
        )
    }
}

private val options = MarkdownOptions(underline = false, permissiveAutolinks = true, hardSoftBreaks = true)

@Composable
fun Markdown(
    text: String,
    inks: Inks,
    modifier: Modifier = Modifier,
    selectable: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    renderer: Renderer = Renderer.device,
) {
    val native = remember(text, maxLines, renderer) { renderer.native(text, maxLines) }
    if (native) Rich(text, inks, modifier, selectable) else Prose(text, inks, modifier, maxLines = maxLines)
}

@Composable
private fun Rich(text: String, inks: Inks, modifier: Modifier, selectable: Boolean) {
    val uri = LocalUriHandler.current
    val view = LocalView.current
    val scheme = MaterialTheme.colorScheme
    val type = MaterialTheme.typography
    val style = remember(inks, scheme, type) { look(inks, scheme, type) }
    EnrichedMarkdownText(
        markdown = text,
        modifier = modifier,
        style = style,
        options = options,
        selectable = selectable,
        codeBlockLayout = CodeBlockLayout.Scrollable,
        onLinkClick = { link ->
            try {
                uri.openUri(link)
            } catch (e: IllegalArgumentException) {
                // No app on the phone opens this kind of link; the tap does nothing, as a plain word would.
            }
        },
        onCodeBlockCopy = { view.buzz(Buzz.Done) },
        includeLastBlockMargin = false,
    )
}

private fun TextStyleScope.from(text: TextStyle, ink: Color, weight: FontWeight?) {
    color = ink
    fontSize = text.fontSize
    lineHeight = text.lineHeight
    fontFamily = text.fontFamily
    fontWeight = weight
    marginTop = 0.dp
    marginBottom = 6.dp
}

private fun look(inks: Inks, scheme: ColorScheme, type: Typography): MarkdownStyle {
    val body = type.bodyLarge
    val small = type.bodySmall
    val rule = inks.ink.copy(alpha = 0.3f)
    return materialMarkdownStyle(scheme).merge {
        paragraph { from(body, inks.ink, body.fontWeight) }
        h1 { from(type.titleLarge, inks.ink, FontWeight.SemiBold) }
        h2 { from(type.titleMedium, inks.ink, FontWeight.SemiBold) }
        h3 { from(body, inks.ink, FontWeight.SemiBold) }
        h4 { from(body, inks.ink, FontWeight.SemiBold) }
        h5 { from(body, inks.ink, FontWeight.SemiBold) }
        h6 { from(body, inks.ink, FontWeight.SemiBold) }
        strong { color = inks.ink }
        emphasis { color = inks.ink }
        strikethrough { color = inks.ink }
        link {
            color = inks.link
            textDecoration = if (inks.underline) TextDecoration.Underline else TextDecoration.None
            backgroundColor = Color.Transparent
        }
        code {
            color = inks.ink
            fontFamily = FontFamily.Monospace
            backgroundColor = inks.code
            borderColor = Color.Transparent
        }
        codeBlock {
            color = inks.ink
            fontFamily = FontFamily.Monospace
            fontSize = small.fontSize
            lineHeight = small.lineHeight
            backgroundColor = inks.code
            borderColor = Color.Transparent
            borderWidth = 0.dp
            cornerRadius = 10.dp
            padding = 8.dp
            marginTop = 0.dp
            marginBottom = 6.dp
        }
        blockquote {
            color = inks.ink
            fontSize = body.fontSize
            lineHeight = body.lineHeight
            borderColor = rule
            borderWidth = 3.dp
            gapWidth = 8.dp
            backgroundColor = Color.Transparent
            marginTop = 0.dp
            marginBottom = 6.dp
        }
        list {
            color = inks.ink
            fontSize = body.fontSize
            lineHeight = body.lineHeight
            bulletColor = inks.ink
            markerColor = inks.ink
            marginTop = 0.dp
            marginBottom = 6.dp
        }
        table {
            color = inks.ink
            fontSize = small.fontSize
            lineHeight = small.lineHeight
            headerTextColor = inks.ink
            headerBackgroundColor = inks.code
            rowEvenBackgroundColor = Color.Transparent
            rowOddBackgroundColor = Color.Transparent
            borderColor = rule
            marginTop = 0.dp
            marginBottom = 6.dp
        }
        thematicBreak {
            color = rule
            marginTop = 0.dp
            marginBottom = 6.dp
        }
    }
}

private enum class Touch { Held, Tapped, Moved }

fun Modifier.held(onHold: () -> Unit): Modifier = pointerInput(Unit) {
    awaitEachGesture {
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        val touch = follow(down)
        val again = touch == Touch.Tapped &&
            withTimeoutOrNull(viewConfiguration.doubleTapTimeoutMillis) { awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial) } != null
        if (touch == Touch.Held || again) {
            onHold()
            swallow()
        }
    }
}

private suspend fun AwaitPointerEventScope.follow(down: PointerInputChange): Touch =
    withTimeoutOrNull(viewConfiguration.longPressTimeoutMillis) {
        var touch: Touch? = null
        while (touch == null) {
            val change = awaitPointerEvent(PointerEventPass.Initial).changes.firstOrNull { it.id == down.id }
            touch = when {
                change == null || !change.pressed -> Touch.Tapped
                (change.position - down.position).getDistance() > viewConfiguration.touchSlop -> Touch.Moved
                else -> null
            }
        }
        touch
    } ?: Touch.Held

private suspend fun AwaitPointerEventScope.swallow() {
    do {
        val event = awaitPointerEvent(PointerEventPass.Initial)
        event.changes.forEach { it.consume() }
    } while (event.changes.any { it.pressed })
}
