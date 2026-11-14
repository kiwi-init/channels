package com.kiwiinit.channels

import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.ui.Line
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdatesFeedTest {
    @Test
    fun aBurstOfGithubUpdatesDoesNotTakeTheFeedLineByLine() {
        val start = System.currentTimeMillis() - 60 * 60_000.0
        var seq = 0
        fun github(n: Int) = MessageView(++seq, "jonatas", start + seq * 60_000.0, "event", "GitHub: $n updates", event = true)
        fun said(text: String) = MessageView(++seq, "lively-swan", start + seq * 60_000.0, "msg", text)
        val messages = List(12) { github(it + 1) } + said("PR #12 is up") + List(12) { github(it + 1) } + said("Merged on green")
        val lines = Line.build(messages, emptyList(), emptyList(), emptyList(), emptyMap())
        val bubbles = lines.filterIsInstance<Line.Bubble>().map { it.message.body }
        assertEquals(listOf("PR #12 is up", "Merged on green"), bubbles)
        val events = lines.count { it is Line.Event }
        assertTrue("24 GitHub updates in two runs drew $events event lines", events <= 2)
    }
}
