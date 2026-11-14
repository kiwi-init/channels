package com.kiwiinit.channels

import com.kiwiinit.channels.ui.updatesByDay
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class UpdatesSheetTest {
    @Test
    fun theSheetListsEveryUpdateNewestFirst() {
        val model = sample(RuntimeEnvironment.getApplication()).also(::githubBurst)
        val messages = model.rooms.getValue(DEV).messages
        val events = messages.filter { it.event }
        assertEquals(24, events.size)
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
        val updates = githubUpdates()
        val two = updates.take(3).map { it.copy(at = it.at - day) } + updates.drop(3)
        val days = updatesByDay(two)
        assertEquals(listOf(21, 3), days.map { it.list.size })
        assertEquals(two.last().seq, days.first().list.first().seq)
    }
}
