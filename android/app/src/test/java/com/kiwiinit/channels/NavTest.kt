package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.navigation.NavGraph
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Ready
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
class NavTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private lateinit var nav: NavHostController

    private val routes: List<String?> get() = nav.currentBackStack.value.filter { it.destination !is NavGraph }.map { it.destination.route }

    @Test
    fun aDoubleTapOnARowOpensItOnce() {
        start(sample(RuntimeEnvironment.getApplication()))
        compose.mainClock.autoAdvance = false
        compose.onAllNodesWithText(LEAD, substring = true)[0].performClick()
        compose.onAllNodesWithText(LEAD, substring = true)[0].performClick()
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        assertEquals(listOf("list", CHAT), routes)
    }

    @Test
    fun aDoubleTapOnBackGoesBackOnce() {
        start(sample(RuntimeEnvironment.getApplication()))
        compose.onAllNodesWithText(LEAD, substring = true)[0].performClick()
        compose.waitForIdle()
        assertEquals(listOf("list", CHAT), routes)
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription(BACK).performClick()
        compose.onNodeWithContentDescription(BACK).performClick()
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        assertEquals(listOf("list"), routes)
    }

    private fun start(model: AppModel) {
        compose.setContent {
            nav = rememberNavController()
            ChannelsTheme { Ready(model, nav) }
        }
        compose.waitForIdle()
    }

    private companion object {
        const val LEAD = "Teamlead Channels"
        const val CHAT = "chat/{code}/{place}"
        const val BACK = "Back. Touch and hold for your other conversations"
    }
}
