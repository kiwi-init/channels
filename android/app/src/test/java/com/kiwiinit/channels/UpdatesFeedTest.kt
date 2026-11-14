package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.Line
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class UpdatesFeedTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private val github = hasText("GitHub: ", substring = true)

    @Test
    fun githubUpdatesLeaveTheFeedAndAllReachTheSheet() {
        val model = sample(RuntimeEnvironment.getApplication()).also(::githubBurst)
        val messages = model.rooms.getValue(DEV).messages
        val events = messages.filter { it.event }
        assertEquals(24, events.count { it.body.startsWith("GitHub: ") })

        val lines = Line.build(messages, emptyList(), emptyList(), emptyList(), emptyMap())
        val eventIds = events.flatMap { listOf("t${it.seq}", "b${it.seq}") }.toSet()
        assertTrue("no feed line comes from an update", lines.none { it.id in eventIds })
        val bubbles = lines.filterIsInstance<Line.Bubble>().map { it.message.body }
        assertEquals(listOf("PR #12 is up for review.", "Merged on green."), bubbles.takeLast(2))

        show(model)
        assertEquals(0, compose.onAllNodes(github).fetchSemanticsNodes().size)
        compose.onNode(hasContentDescription("Updates") and hasClickAction()).performClick()
        compose.waitForIdle()
        val shown = texts()
        assertTrue("the sheet lists updates", shown.isNotEmpty())
        assertEquals("Jow ${events.last().body}", shown.first())
        compose.onNode(hasScrollToIndexAction() and hasAnyDescendant(github)).performScrollToNode(hasText(events.first().body, substring = true))
    }

    @Test
    fun anUpdatesOnlyHistoryShowsAnEmptyFeedAndEveryUpdateInTheSheet() {
        val model = sample(RuntimeEnvironment.getApplication()).also(::onlyGithub)
        val messages = model.rooms.getValue(DEV).messages
        assertEquals(emptyList<Line>(), Line.build(messages, emptyList(), emptyList(), emptyList(), emptyMap()))

        show(model)
        assertEquals(0, compose.onAllNodes(github).fetchSemanticsNodes().size)
        compose.onNode(hasContentDescription("Updates") and hasClickAction()).performClick()
        compose.waitForIdle()
        assertEquals("Jow ${messages.last().body}", texts().first())
    }

    @Test
    fun openingAndClosingTheSheetKeepsThePlaceAndTheDraft() {
        val model = sample(RuntimeEnvironment.getApplication()).also(::githubBurst)
        show(model)
        compose.onNode(hasSetTextAction()).performTextInput("half a thought")
        compose.onNode(hasScrollToIndexAction()).performTouchInput { swipeDown() }
        compose.waitForIdle()
        val before = scrolled()
        assertTrue("the feed scrolled up from the bottom", before > 0f)

        compose.onNode(hasContentDescription("Updates") and hasClickAction()).performClick()
        compose.waitForIdle()
        assertTrue(texts().isNotEmpty())
        compose.onNode(hasContentDescription("Close") and hasClickAction()).performClick()
        compose.waitForIdle()

        assertEquals(0, texts().size)
        assertEquals(before, scrolled())
        compose.onNode(hasSetTextAction() and hasText("half a thought")).assertExists()
    }

    private fun show(model: AppModel) {
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) {
                    ConversationScreen(model, Spot(DEV), back = {})
                }
            }
        }
        compose.mainClock.advanceTimeBy(1000)
        compose.waitForIdle()
    }

    private fun texts(): List<String> =
        compose.onAllNodes(github).fetchSemanticsNodes().flatMap { node -> node.config.getOrNull(SemanticsProperties.Text)?.map { it.text } ?: emptyList() }

    private fun scrolled(): Float =
        compose.onNode(hasScrollToIndexAction()).fetchSemanticsNode().config.getOrNull(SemanticsProperties.VerticalScrollAxisRange)?.value?.invoke() ?: -1f
}
