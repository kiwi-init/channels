package com.kiwiinit.channels.model

import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

const val MAX_IMAGE_BYTES = 256 * 1024
const val MAX_IMAGE_SIDE = 4096
const val WEBP_FLOOR = 10
const val JPEG_FLOOR = 25
private const val TOP = 92
private const val STEPS = 5

class Fitted(val width: Int, val height: Int, val bytes: ByteArray)

fun capped(width: Int, height: Int): Pair<Int, Int> {
    val scale = min(1.0, MAX_IMAGE_SIDE.toDouble() / max(width, height))
    return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
}

fun shrinkBy(size: Int?, limit: Int): Double =
    if (size == null) 0.5 else min(0.9, max(0.5, sqrt(limit.toDouble() / size) * 0.95))

fun fitImage(width: Int, height: Int, limit: Int, floor: Int, encode: (width: Int, height: Int, quality: Int) -> ByteArray?): Fitted? {
    var (w, h) = capped(width, height)
    while (true) {
        val at = { quality: Int -> encode(w, h, quality)?.let { Fitted(w, h, it) } }
        val top = at(TOP)
        if (top != null && top.bytes.size <= limit) return top
        var best: Fitted? = null
        var lo = floor
        var hi = TOP
        repeat(STEPS) {
            val mid = (lo + hi) / 2
            if (mid == lo) return@repeat
            val got = at(mid)
            if (got != null && got.bytes.size <= limit) {
                best = got
                lo = mid
            } else {
                hi = mid
            }
        }
        best?.let { return it }
        val low = at(floor)
        if (low != null && low.bytes.size <= limit) return low
        if (w == 1 && h == 1) return null
        val k = shrinkBy(low?.bytes?.size, limit)
        w = max(1, (w * k).toInt())
        h = max(1, (h * k).toInt())
    }
}
