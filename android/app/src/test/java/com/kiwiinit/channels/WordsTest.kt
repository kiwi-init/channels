package com.kiwiinit.channels

import com.kiwiinit.channels.model.Language
import com.kiwiinit.channels.model.TaskCounts
import com.kiwiinit.channels.model.Words
import com.kiwiinit.channels.ui.When
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class WordsTest {
    private val w = Words(RuntimeEnvironment.getApplication().resources)

    @Test
    fun englishReadsAsItDidBefore() {
        assertEquals("1 working · 2 in review · 3 to do", TaskCounts(1, 2, 3).line(w))
        assertEquals("Nothing open", TaskCounts(0, 0, 0).line(w))
        assertEquals("1 needs you", w.count(R.plurals.n_need_you, 1))
        assertEquals("4 need you", w.count(R.plurals.n_need_you, 4))
        assertEquals("Is this your key, Jow?", w(R.string.key_check_title, "Jow"))
        assertEquals("It doesn't match", w(R.string.key_differs))
    }

    @Test
    fun timesUseTheWords() {
        val now = 1_800_000_000_000L
        assertEquals("now", When.short(w, now - 5_000, now))
        assertEquals("7m", When.short(w, now - 7 * 60_000, now))
        assertEquals("Today", When.dayWord(w, now, now))
    }

    @Test
    fun theFiveLanguagesNameThemselves() {
        assertEquals(listOf("en", "pt-BR", "ja", "ko", "zh-CN"), Language.choices.map { it.first })
        assertEquals("System", w(R.string.language_system))
    }
}
