package com.kiwiinit.channels

import com.kiwiinit.channels.ui.updatesByDay
import java.time.Instant
import java.util.TimeZone
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdatesSheetTest {
    private val zone: TimeZone = TimeZone.getDefault()

    @Before
    fun pinZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    @After
    fun restoreZone() {
        TimeZone.setDefault(zone)
    }

    @Test
    fun theSheetListsEveryUpdateNewestFirst() {
        val model = sample(RuntimeEnvironment.getApplication()).also(::githubBurst)
        val messages = model.rooms.getValue(DEV).messages
        val events = messages.filter { it.event }
        assertEquals(24, events.count { it.body.startsWith("GitHub: ") })
        assertEquals(events.map { it.seq }.reversed(), updatesByDay(messages).flatMap { it.list }.map { it.seq })
    }

    @Test
    fun anUpdatesOnlyHistoryListsThemAll() {
        val messages = githubUpdates()
        assertEquals(messages.map { it.seq }.reversed(), updatesByDay(messages).flatMap { it.list }.map { it.seq })
    }

    @Test
    fun daysSplitNewestFirst() {
        val day = 24 * 60 * 60_000.0
        for (now in listOf("2026-11-17T00:31:00Z", "2026-11-16T12:00:00Z", "2026-11-16T23:59:00Z")) {
            val updates = githubUpdates(at(now))
            val two = updates.take(3).map { it.copy(at = it.at - day) } + updates.drop(3)
            val days = updatesByDay(two)
            assertEquals(now, listOf(21, 3), days.map { it.list.size })
            assertEquals(now, two.last().seq, days.first().list.first().seq)
        }
    }

    @Test
    fun updatesAcrossMidnightSplitAtMidnight() {
        val updates = githubUpdates(at("2026-11-17T00:15:00Z"))
        val days = updatesByDay(updates)
        assertEquals(listOf(9, 15), days.map { it.list.size })
        assertEquals(updates.last().seq, days.first().list.first().seq)
        assertEquals(updates.first().seq, days.last().list.last().seq)
    }

    private fun at(instant: String): Double = Instant.parse(instant).toEpochMilli().toDouble()
}
