package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class ReviewTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aTaskThreadInReviewShowsItsReviewCard() {
        open(Spot(DEV, "task:543"))
        compose.onNodeWithText("Approve").assertExists()
        compose.onNodeWithText("Send back…").assertExists()
    }

    @Test
    fun anotherTasksThreadShowsNoReviewCard() {
        open(Spot(DEV, "task:24"))
        compose.onNodeWithText("Approve").assertDoesNotExist()
    }

    private fun open(spot: Spot) {
        val model = sample(RuntimeEnvironment.getApplication())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, spot, back = {}) }
            }
        }
        compose.waitForIdle()
    }
}
