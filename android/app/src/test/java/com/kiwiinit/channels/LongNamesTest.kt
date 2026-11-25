package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Home
import com.kiwiinit.channels.ui.Tab
import com.kiwiinit.channels.ui.initials
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
class LongNamesTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aNameStartingWithAnEmojiShowsTheWholeEmoji() {
        assertEquals("🦊F", initials("🦊 Fox"))
        assertEquals("👩‍💻D", initials("👩‍💻 Dev"))
        assertEquals("JW", initials("jonatas walker"))
    }

    @Test
    fun aLongChannelNameKeepsWhoIsWorking() {
        val model = sample(RuntimeEnvironment.getApplication())
        model.rooms[DEV] = model.rooms.getValue(DEV).copy(title = LONG)
        show(model, Tab.Chats)
        compose.onNodeWithText(" · 2 working").assertIsDisplayed()
    }

    @Test
    fun aLongRelayKeepsItsLabel() {
        val model = sample(RuntimeEnvironment.getApplication())
        model.relay = "https://$LONG.example.com"
        show(model, Tab.Settings)
        compose.onNodeWithText("Relay").assertIsDisplayed()
    }

    private fun show(model: AppModel, tab: Tab) {
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { Home(model, open = {}, tasks = {}, first = tab) }
            }
        }
        compose.waitForIdle()
    }

    private companion object {
        const val LONG = "the-channel-with-a-name-so-long-it-runs-past-the-edge-of-any-phone"
    }
}
