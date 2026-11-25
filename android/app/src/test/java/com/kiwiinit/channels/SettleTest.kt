package com.kiwiinit.channels

import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.model.Feed
import com.kiwiinit.channels.model.Pending
import com.kiwiinit.channels.model.settledPending
import org.junit.Assert.assertEquals
import org.junit.Test

class SettleTest {
    private fun sent(seq: Int?) = Pending(id = "p$seq", body = "hi", re = null, at = 0L, seq = seq)
    private fun feed(vararg seqs: Int) = Feed(seqs.map { MessageView(seq = it, from = "jow", at = 0.0, kind = "human", body = "hi") }, whole = false)

    @Test
    fun aSentCopyInARoomOrTaskThreadClearsOnceItsMessageArrives() {
        val pending = mapOf("dev|$DESIGN_ROOM" to listOf(sent(7), sent(null)), "dev|task:3" to listOf(sent(9)))
        val feeds = mapOf("dev|$DESIGN_ROOM" to feed(6, 7), "dev|task:3" to feed(9))
        val got = settledPending("dev", LEAD_CHAT, null, pending, feeds)
        assertEquals(listOf(sent(null)), got["dev|$DESIGN_ROOM"])
        assertEquals(emptyList<Pending>(), got["dev|task:3"])
    }

    @Test
    fun generalAndTheLeadChatStillClearAndOtherChannelsAreLeftAlone() {
        val pending = mapOf("dev|main" to listOf(sent(4)), "dev|$LEAD_CHAT" to listOf(sent(5)), "site|main" to listOf(sent(4)))
        val got = settledPending("dev", LEAD_CHAT, listOf(feed(5).messages.single()), pending, mapOf("dev|main" to feed(4), "site|main" to feed(4)))
        assertEquals(mapOf("dev|main" to emptyList<Pending>(), "dev|$LEAD_CHAT" to emptyList()), got)
    }
}
