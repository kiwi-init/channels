package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.and
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
class DockTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aMentionOnANewLineIsOfferedAndCompleted() {
        val model = sample(RuntimeEnvironment.getApplication())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) {
                    ConversationScreen(model, Spot(DEV), chosen = null, consumeChosen = {}, back = {}, details = {})
                }
            }
        }
        compose.onNode(hasSetTextAction()).performClick().performTextInput("Thanks\n@liv")
        compose.onNode(hasText("Teamlead Channels") and hasClickAction()).performClick()
        compose.onNode(hasSetTextAction()).assert(hasText("Thanks\n@lively-swan "))
    }
}
