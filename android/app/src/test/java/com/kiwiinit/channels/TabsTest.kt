package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.PlaceView
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Home
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
class TabsTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun chatsKeepsItsScrollAcrossTabs() {
        val model = sample(RuntimeEnvironment.getApplication())
        val room = model.rooms.getValue(DEV)
        model.rooms[DEV] = room.copy(places = room.places + (1..60).map { PlaceView("room:r%02d".format(it), "room", "r%02d".format(it)) })
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { Home(model, open = {}, tasks = {}) }
            }
        }
        val top = hasText("Teamlead", substring = true)
        compose.onNode(top).assertExists()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Nothing open"))
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(top).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithText("You").performClick()
        compose.onNodeWithText("Chats").performClick()
        compose.waitForIdle()
        assertTrue(compose.onAllNodes(top).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithText("Nothing open").assertIsDisplayed()
    }
}
