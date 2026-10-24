package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Guarded
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class LockTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()
    private val locked = mutableStateOf(false)

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

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
    fun lockingPutsTheKeyboardAway() {
        compose.setContent {
            ChannelsTheme {
                Guarded(locked.value, unlock = {}) {
                    var text by remember { mutableStateOf("") }
                    BasicTextField(text, { text = it })
                }
            }
        }
        compose.onNode(hasSetTextAction()).performClick().assertIsFocused()
        locked.value = true
        compose.waitForIdle()
        compose.onNode(hasSetTextAction()).assertIsNotFocused()
    }
}
