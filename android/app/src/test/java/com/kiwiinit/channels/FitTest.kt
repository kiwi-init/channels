package com.kiwiinit.channels

import com.kiwiinit.channels.model.MAX_IMAGE_BYTES
import com.kiwiinit.channels.model.MAX_IMAGE_SIDE
import com.kiwiinit.channels.model.capped
import com.kiwiinit.channels.model.fitImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FitTest {
    private fun fake(bytesPerPixel: (Int) -> Double, seen: MutableList<Triple<Int, Int, Int>> = mutableListOf()) = { w: Int, h: Int, q: Int ->
        seen.add(Triple(w, h, q))
        ByteArray((w * h * bytesPerPixel(q)).toInt())
    }

    @Test
    fun aBigScreenshotKeepsEveryPixelAtTheBestQualityThatFits() {
        val got = fitImage(2556, 1179, MAX_IMAGE_BYTES, 10, fake({ q -> q / 400.0 }))!!
        assertEquals(2556, got.width)
        assertEquals(1179, got.height)
        assertTrue(got.bytes.size <= MAX_IMAGE_BYTES)
        assertTrue(got.bytes.size > MAX_IMAGE_BYTES * 0.9)
    }

    @Test
    fun pixelsGoOnlyAfterTheLowestQualityIsTooBig() {
        val seen = mutableListOf<Triple<Int, Int, Int>>()
        val got = fitImage(4000, 3000, MAX_IMAGE_BYTES, 10, fake({ 0.5 }, seen))!!
        assertTrue(got.bytes.size <= MAX_IMAGE_BYTES)
        val shrunk = seen.indexOfFirst { it.first < 4000 }
        assertTrue(shrunk > 0)
        assertTrue(seen.take(shrunk).any { it.third == 10 })
    }

    @Test
    fun anEncoderThatAlwaysFailsEnds() {
        assertNull(fitImage(5000, 5000, MAX_IMAGE_BYTES, 10) { _, _, _ -> null })
    }

    @Test
    fun theSideCapNeverUpscales() {
        assertEquals(MAX_IMAGE_SIDE to MAX_IMAGE_SIDE / 2, capped(8192, 4096))
        assertEquals(800 to 600, capped(800, 600))
    }
}
