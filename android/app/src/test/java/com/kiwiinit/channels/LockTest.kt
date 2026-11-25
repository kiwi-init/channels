package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.fragment.app.FragmentActivity
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.Lock
import com.kiwiinit.channels.model.Words
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Guarded
import java.time.Duration
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class LockTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    private val locked = mutableStateOf(false)

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aPhoneNotLinkedYetIsNotLockedWhenItComesBackFromSigningIn() {
        val app = RuntimeEnvironment.getApplication()
        val activity = Robolectric.buildActivity(FragmentActivity::class.java).setup().get()
        val lock = Lock(app, linked = false, guarding = { false }) { Words(app.resources) }
        val prompt = lock.prompt(activity)
        lock.left()
        ShadowSystemClock.advanceBy(Duration.ofSeconds(45))
        lock.back(prompt)
        assertFalse(lock.locked)
    }

    @Test
    fun backOnTheLockScreenKeepsTheConversationBehindIt() {
        lateinit var nav: NavHostController
        compose.setContent {
            nav = rememberNavController()
            ChannelsTheme {
                Guarded(locked.value, unlock = {}) {
                    NavHost(nav, startDestination = "list") {
                        composable("list") { Text("The list") }
                        composable("chat") { Text("A conversation") }
                    }
                }
            }
        }
        compose.runOnUiThread { nav.navigate("chat") }
        compose.waitForIdle()
        locked.value = true
        compose.waitForIdle()
        compose.runOnUiThread { compose.activity.onBackPressedDispatcher.onBackPressed() }
        compose.waitForIdle()
        locked.value = false
        compose.waitForIdle()
        compose.onNodeWithText("A conversation").assertExists()
        compose.onNodeWithText("The list").assertDoesNotExist()
    }

    @Test
    fun lockingPutsTheKeyboardAwayAndHidesWhatsBehind() {
        compose.setContent {
            ChannelsTheme {
                Guarded(locked.value, unlock = {}) {
                    var text by rememberSaveable { mutableStateOf("") }
                    BasicTextField(text, { text = it })
                }
            }
        }
        compose.onNode(hasSetTextAction()).performClick().assertIsFocused()
        compose.onNode(hasSetTextAction()).performTextInput("half a thought")
        locked.value = true
        compose.waitForIdle()
        compose.onAllNodes(hasSetTextAction()).assertCountEquals(0)
        compose.onNodeWithText("Channels is locked").assertExists()
        locked.value = false
        compose.waitForIdle()
        compose.onNodeWithText("half a thought").assertExists()
    }
}
