package com.kiwiinit.channels

import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.model.othersOf
import org.junit.Assert.assertEquals
import org.junit.Test

class OthersTest {
    private fun member(name: String, person: String?, kind: String = "human") = MemberView(name = name, display = name, kind = kind, person = person)

    @Test
    fun aPhoneSeatDoesNotCountItsOwnPersonsDesktopSeat() {
        val members = listOf(member("jow", "person:u-jow"), member("jow-2", "person:u-jow"), member("lead", "seat:lead", "agent"), member("maya", "person:u-maya"))
        assertEquals(listOf("lead", "maya"), othersOf(members, "jow-2").map { it.name })
    }

    @Test
    fun withoutAPersonOnRecordOnlyYourOwnSeatIsLeftOut() {
        val members = listOf(member("jow", null), member("jow-2", null), member("lead", null, "agent"))
        assertEquals(listOf("jow", "lead"), othersOf(members, "jow-2").map { it.name })
    }
}
