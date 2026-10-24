package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.DetailsScreen
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class AnswerTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aTypedAnswerThatDoesNotSendStaysWithWhy() {
        details()
        compose.onAllNodesWithText("Something else")[0].performClick()
        compose.onNode(hasSetTextAction()).performClick().performTextInput("Not tonight")
        compose.onNodeWithContentDescription("Send answer").performClick()
        compose.waitForIdle()
        compose.onNode(hasSetTextAction()).assert(hasText("Not tonight"))
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
    }

    @Test
    fun aChoiceThatDoesNotSendSaysSo() {
        details()
        compose.onNodeWithText("Remove it").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
    }

    private fun details() {
        val model = sample(RuntimeEnvironment.getApplication())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { DetailsScreen(model, DEV, "main", back = {}, choose = {}, newAgent = {}) }
            }
        }
        compose.waitForIdle()
    }
}
