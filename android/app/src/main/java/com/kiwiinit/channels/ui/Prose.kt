package com.kiwiinit.channels.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

sealed interface Block {
    data class Words(val text: String) : Block

    data class Code(val text: String) : Block

    companion object {
        fun parse(text: String): List<Block> {
            val out = mutableListOf<Block>()
            val buffer = mutableListOf<String>()
            var inCode = false
            for (line in text.split("\n")) {
                if (line.trim().startsWith("```")) {
                    val joined = buffer.joinToString("\n")
                    if (inCode) {
                        out += Code(joined)
                    } else if (joined.isNotBlank()) {
                        out += Words(joined)
                    }
                    buffer.clear()
                    inCode = !inCode
                    continue
                }
                buffer += line
            }
            val rest = buffer.joinToString("\n")
            if (rest.isNotBlank()) out += if (inCode) Code(rest) else Words(rest)
            return out
        }
    }
}

data class Inks(val ink: Color, val link: Color, val code: Color, val underline: Boolean)

private val url = Regex("""https?://[^\s<>()\[\]]+[^\s<>()\[\].,;:!?'"]""")

private fun AnnotatedString.Builder.words(s: String, inks: Inks) {
    var i = 0
    val plain = StringBuilder()
    fun flush() {
        if (plain.isNotEmpty()) {
            append(plain.toString())
            plain.clear()
        }
    }
    while (i < s.length) {
        val c = s[i]
        val before = if (i == 0) ' ' else s[i - 1]
        if (c == '`') {
            val end = s.indexOf('`', i + 1)
            if (end > i + 1) {
                flush()
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = inks.code)) { append(s.substring(i + 1, end)) }
                i = end + 1
                continue
            }
        }
        if (s.startsWith("**", i)) {
            val end = s.indexOf("**", i + 2)
            if (end > i + 2) {
                flush()
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { words(s.substring(i + 2, end), inks) }
                i = end + 2
                continue
            }
        }
        if (s.startsWith("~~", i)) {
            val end = s.indexOf("~~", i + 2)
            if (end > i + 2) {
                flush()
                withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { words(s.substring(i + 2, end), inks) }
                i = end + 2
                continue
            }
        }
        if ((c == '*' || c == '_') && !before.isLetterOrDigit() && i + 1 < s.length && !s[i + 1].isWhitespace()) {
            var end = s.indexOf(c, i + 1)
            while (end > 0 && end + 1 < s.length && s[end + 1].isLetterOrDigit()) end = s.indexOf(c, end + 1)
            if (end > i + 1 && !s[end - 1].isWhitespace()) {
                flush()
                withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { words(s.substring(i + 1, end), inks) }
                i = end + 1
                continue
            }
        }
        if (c == '[') {
            val close = s.indexOf("](", i + 1)
            val end = if (close > i) s.indexOf(')', close + 2) else -1
            if (close > i + 1 && end > close + 2) {
                val target = s.substring(close + 2, end)
                if (target.startsWith("http://") || target.startsWith("https://")) {
                    flush()
                    withLink(LinkAnnotation.Url(target, styles(inks))) { words(s.substring(i + 1, close), inks) }
                    i = end + 1
                    continue
                }
            }
        }
        if (c == 'h' && !before.isLetterOrDigit()) {
            val match = url.find(s, i)?.takeIf { it.range.first == i }
            if (match != null) {
                flush()
                withLink(LinkAnnotation.Url(match.value, styles(inks))) { append(match.value) }
                i += match.value.length
                continue
            }
        }
        plain.append(c)
        i++
    }
    flush()
}

private fun styles(inks: Inks): TextLinkStyles =
    TextLinkStyles(style = SpanStyle(color = inks.link, textDecoration = if (inks.underline) TextDecoration.Underline else null))

fun styled(text: String, inks: Inks): AnnotatedString = buildAnnotatedString { words(text, inks) }

@Composable
fun Prose(
    text: String,
    inks: Inks,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyLarge,
    maxLines: Int = Int.MAX_VALUE,
) {
    val blocks = remember(text) { Block.parse(text) }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (block in blocks) {
            when (block) {
                is Block.Words -> {
                    val shown = remember(block.text, inks) { styled(block.text, inks) }
                    Text(shown, style = style, color = inks.ink, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
                }
                is Block.Code ->
                    Box(Modifier.background(inks.code, RoundedCornerShape(10.dp)).horizontalScroll(rememberScrollState())) {
                        Text(
                            block.text,
                            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                            color = inks.ink,
                            softWrap = false,
                            modifier = Modifier.padding(8.dp),
                        )
                    }
            }
        }
    }
}
