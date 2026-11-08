package com.kiwiinit.channels

import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.NeedsScreen
import kotlin.math.roundToInt
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class KeyboardTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun answerInNeedsStaysAboveTheKeyboard() {
        show { NeedsScreen(it) {} }
        compose.onAllNodesWithText("Something else")[1].performScrollTo().performClick()
        compose.onNode(hasSetTextAction()).performClick()
        aboveKeyboard(compose.onNode(hasSetTextAction()), keyboard())
    }

    @Test
    fun sendBackInNeedsStaysAboveTheKeyboard() {
        show { NeedsScreen(it) {} }
        compose.onNodeWithText("Send back").performScrollTo().performClick()
        compose.onNode(hasSetTextAction()).performClick()
        aboveKeyboard(compose.onNode(hasSetTextAction()), keyboard())
    }

    private fun show(prepare: (AppModel) -> Unit = {}, screen: @Composable (AppModel) -> Unit) {
        val model = sample(RuntimeEnvironment.getApplication())
        prepare(model)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { screen(model) }
            }
        }
        compose.waitForIdle()
    }

    private fun keyboard(): Int {
        val height = (KEYBOARD_DP * compose.activity.resources.displayMetrics.density).roundToInt()
        compose.runOnUiThread {
            val content = compose.activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0)
            val insets = WindowInsetsCompat.Builder()
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.of(0, 0, 0, height))
                .setVisible(WindowInsetsCompat.Type.ime(), true)
                .build()
            ViewCompat.dispatchApplyWindowInsets(content, insets)
        }
        compose.waitForIdle()
        return height
    }

    private fun aboveKeyboard(node: SemanticsNodeInteraction, keyboard: Int) {
        compose.waitForIdle()
        val bottom = node.fetchSemanticsNode().boundsInRoot.bottom
        val top = compose.onRoot().fetchSemanticsNode().size.height - keyboard
        assertTrue("It ends at ${bottom.roundToInt()} px, under the keyboard's top at $top px", bottom <= top)
    }

    private companion object {
        const val KEYBOARD_DP = 320
    }
}
