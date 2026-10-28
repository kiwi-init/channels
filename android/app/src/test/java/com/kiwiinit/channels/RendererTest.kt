package com.kiwiinit.channels

import com.kiwiinit.channels.ui.Renderer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RendererTest {
    @Test
    fun aParserThatLoadsDrawsNatively() {
        assertTrue(Renderer(load = { true }, parse = { Any() }).native("**hi**"))
    }

    @Test
    fun aParserThatThrowsOnLoadFallsBackToProse() {
        var parsed = 0
        val renderer = Renderer(load = { throw UnsatisfiedLinkError("no enriched_markdown_parser") }, parse = {
            parsed++
            Any()
        })
        assertFalse(renderer.native("**hi**"))
        assertEquals(0, parsed)
    }

    @Test
    fun aLoaderThatSaysNoFallsBackToProse() {
        assertFalse(Renderer(load = { false }, parse = { Any() }).native("**hi**"))
    }

    @Test
    fun aMessageTheParserRejectsFallsBackAlone() {
        val renderer = Renderer(load = { true }, parse = { if (it == "bad") throw IllegalStateException("bad") else Any() })
        assertFalse(renderer.native("bad"))
        assertTrue(renderer.native("good"))
    }

    @Test
    fun aParserThatReturnsNothingFallsBackToProse() {
        assertFalse(Renderer(load = { true }, parse = { null }).native("**hi**"))
    }

    @Test
    fun cappedLinesStayWithProse() {
        assertFalse(Renderer(load = { true }, parse = { Any() }).native("**hi**", maxLines = 2))
    }

    @Test
    fun theLibraryLoadsOnce() {
        var loads = 0
        val renderer = Renderer(load = {
            loads++
            true
        }, parse = { Any() })
        repeat(3) { renderer.native("message $it") }
        assertEquals(1, loads)
    }

    @Test
    fun theJvmHasNoParserSoItDrawsWithProse() {
        assertFalse(Renderer.device.native("**hi**"))
    }
}
