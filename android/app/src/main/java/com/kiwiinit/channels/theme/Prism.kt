package com.kiwiinit.channels.theme

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

object Spectrum {
    val colors: List<Color> = listOf(0xFFFF3B5C, 0xFFFFB02E, 0xFFF5FF5A, 0xFF5DFF8F, 0xFF39D4FF, 0xFF3D5BFF, 0xFFB04DFF).map { Color(it) }

    fun band(center: Float, glint: Color): Array<Pair<Float, Color>> {
        val c = min(0.9f, max(0.1f, center))
        val stops = mutableListOf(
            c - 0.08f to Color.Transparent,
            c - 0.065f to glint.copy(alpha = 0.4f),
            c - 0.05f to Color.Transparent,
        )
        colors.forEachIndexed { i, color -> stops += (c - 0.035f + i * 0.015f) to color }
        stops += (c + 0.08f) to Color.Transparent
        return stops.toTypedArray()
    }

    fun glint(glint: Color): Array<Pair<Float, Color>> =
        arrayOf(
            0f to glint,
            0.26f to glint.copy(alpha = 0.3f),
            0.62f to glint.copy(alpha = 0.12f),
            1f to glint.copy(alpha = 0.6f),
        )

    fun line(degrees: Float, size: Size): Pair<Offset, Offset> {
        val r = Math.toRadians(degrees.toDouble())
        val dx = (sin(r) / 2).toFloat()
        val dy = (-cos(r) / 2).toFloat()
        return Offset(size.width * (0.5f - dx), size.height * (0.5f - dy)) to Offset(size.width * (0.5f + dx), size.height * (0.5f + dy))
    }
}

fun Modifier.prism(radius: Dp, dark: Boolean, band: Float = 0.7f): Modifier =
    drawWithContent {
        val corner = CornerRadius(radius.toPx())
        val fill = if (dark) Color.White.copy(alpha = 0.09f) else Color(0xFF0F0F11).copy(alpha = 0.045f)
        val edge = if (dark) Color.White.copy(alpha = 0.08f) else Color(0xFF0F0F11).copy(alpha = 0.1f)
        val glint = if (dark) Color.White else Color(0xFF0F0F11).copy(alpha = 0.72f)
        val sweep = Spectrum.line(112f, size)
        val shine = Spectrum.line(140f, size)
        drawRoundRect(fill, cornerRadius = corner)
        drawRoundRect(Brush.linearGradient(*Spectrum.band(band, glint), start = sweep.first, end = sweep.second), cornerRadius = corner, alpha = 0.3f)
        drawContent()
        val stroke = Stroke(width = 1f)
        drawRoundRect(edge, cornerRadius = corner, style = stroke)
        drawRoundRect(Brush.linearGradient(*Spectrum.glint(glint), start = shine.first, end = shine.second), cornerRadius = corner, style = stroke)
    }
