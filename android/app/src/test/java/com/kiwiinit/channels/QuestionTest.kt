package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
class QuestionTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aQuestionWaitingForYouTakesATapWhetherOrNotItHoldsWork() {
        open(waiting = true)
        compose.onNodeWithText("Take it now").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
    }

    @Test
    fun aQuestionNotWaitingForYouStaysShut() {
        open(waiting = false)
        compose.onNodeWithText("Question").assertExists()
        compose.onNodeWithText("Take it now").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Couldn't send · Try again").assertDoesNotExist()
    }

    private fun open(waiting: Boolean) {
        val model = sample(RuntimeEnvironment.getApplication())
        unheldQuestion(model, waiting)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, Spot(DEV), back = {}) }
            }
        }
        compose.waitForIdle()
    }
}
