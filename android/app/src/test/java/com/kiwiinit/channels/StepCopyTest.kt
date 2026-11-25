package com.kiwiinit.channels

import android.content.ClipboardManager
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
class StepCopyTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun tappingAStepCommandCopiesIt() {
        val app = RuntimeEnvironment.getApplication()
        val model = sample(app)
        stepAsked(model, waiting = true)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, Spot(DEV), back = {}) }
            }
        }
        compose.onNodeWithText("bun run sign").performClick()
        compose.waitForIdle()
        val clip = app.getSystemService(ClipboardManager::class.java).primaryClip
        assertEquals("bun run sign", clip?.getItemAt(0)?.text?.toString())
    }
}
