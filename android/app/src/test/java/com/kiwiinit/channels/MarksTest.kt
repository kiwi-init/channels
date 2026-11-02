package com.kiwiinit.channels

import com.kiwiinit.channels.model.marksOf
import com.kiwiinit.channels.model.raisedMarks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MarksTest {
    private val keys = listOf("main", "dm:jow~lead")
    private val seen = mapOf("code" to 31, "other" to 99)
    private val placeSeen = mapOf("code|dm:jow~lead" to 12, "code|task:7" to 5, "other|dm:jow~lead" to 80)

    @Test
    fun aPhoneSharesOnlyGeneralAndTheLeadChatOfThatChannel() {
        assertEquals(mapOf("main" to 31, "dm:jow~lead" to 12), marksOf("code", keys, seen, placeSeen))
        assertEquals(mapOf("main" to 2), marksOf("new", keys, mapOf("new" to 2), emptyMap()))
    }

    @Test
    fun whatTheDesktopReadRaisesThePhonesMarksAndNeverLowersThem() {
        val got = raisedMarks("code", keys, mapOf("main" to 40, "dm:jow~lead" to 9, "task:7" to 30), seen, placeSeen)
        assertEquals(mapOf("code" to 40), got.seen)
        assertEquals(emptyMap<String, Int>(), got.placeSeen)
        val side = raisedMarks("code", keys, mapOf("main" to 31, "dm:jow~lead" to 20), seen, placeSeen)
        assertEquals(emptyMap<String, Int>(), side.seen)
        assertEquals(mapOf("code|dm:jow~lead" to 20), side.placeSeen)
        assertTrue(raisedMarks("code", keys, mapOf("main" to 3), seen, placeSeen).isEmpty)
    }
}
