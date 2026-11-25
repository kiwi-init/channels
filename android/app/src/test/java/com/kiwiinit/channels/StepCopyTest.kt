package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class StepCopyTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aStepCommandCanBeSelectedToCopy() {
        val toolbar = Toolbar()
        val model = sample(RuntimeEnvironment.getApplication())
        stepAsked(model, waiting = true)
        compose.setContent {
            CompositionLocalProvider(LocalTextToolbar provides toolbar) {
                ChannelsTheme {
                    Surface(Modifier.fillMaxSize()) { ConversationScreen(model, Spot(DEV), back = {}) }
                }
            }
        }
        compose.onNodeWithText("bun run sign").performTouchInput { longClick() }
        compose.waitForIdle()
        assertNotNull(toolbar.copy)
    }

    private class Toolbar : TextToolbar {
        var copy: (() -> Unit)? = null
        override val status: TextToolbarStatus get() = if (copy == null) TextToolbarStatus.Hidden else TextToolbarStatus.Shown

        override fun hide() {
            copy = null
        }

        override fun showMenu(rect: Rect, onCopyRequested: (() -> Unit)?, onPasteRequested: (() -> Unit)?, onCutRequested: (() -> Unit)?, onSelectAllRequested: (() -> Unit)?) {
            copy = onCopyRequested
        }
    }
}
