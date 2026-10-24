package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performScrollToIndex
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class UnseenTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun threeMessagesInOnePushCountAsThreeNew() {
        val model = sample(RuntimeEnvironment.getApplication())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) {
                    ConversationScreen(model, Spot(DEV), chosen = null, consumeChosen = {}, back = {}, details = {})
                }
            }
        }
        compose.onNode(hasScrollToIndexAction()).performScrollToIndex(5)
        compose.waitForIdle()
        val scrolled = jumps()
        val room = model.rooms.getValue(DEV)
        val at = room.messages.last().at
        val more = (1..3).map { MessageView(100 + it, "gentle-jaguar", at + it * 1000.0, "msg", "Update $it") }
        compose.runOnUiThread { model.rooms[DEV] = room.copy(messages = room.messages + more) }
        compose.waitForIdle()
        assertEquals("after scrolling: $scrolled", listOf("3 new, jump to the latest"), jumps())
    }

    private fun jumps(): List<String> =
        compose.onAllNodes(hasContentDescription("jump to the latest", substring = true, ignoreCase = true))
            .fetchSemanticsNodes()
            .flatMap { it.config.getOrNull(SemanticsProperties.ContentDescription) ?: emptyList() }
}
