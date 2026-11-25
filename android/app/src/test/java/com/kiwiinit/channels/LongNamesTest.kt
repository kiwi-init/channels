package com.kiwiinit.channels

import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Home
import com.kiwiinit.channels.ui.Tab
import com.kiwiinit.channels.ui.initials
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
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
        compose.onNodeWithText(" · 2 working").assertWidthIsAtLeast(60.dp)
    }

    @Test
    fun aLongRelayKeepsItsLabel() {
        val model = sample(RuntimeEnvironment.getApplication()) { request ->
            when (request.getValue("op").jsonPrimitive.content) {
                "enrollFinish" -> buildJsonObject {
                    put("relay", "https://$LONG.example.com")
                    put("person", buildJsonObject { put("name", "Jow") })
                    putJsonArray("seats") {}
                }
                "start" -> JsonPrimitive(1)
                else -> JsonNull
            }
        }
        model.keepLink()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals("https://$LONG.example.com", model.relay)
        show(model, Tab.Settings)
        compose.onNodeWithText("Relay").assertWidthIsAtLeast(40.dp)
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
