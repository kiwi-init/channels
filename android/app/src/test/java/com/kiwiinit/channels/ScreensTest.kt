package com.kiwiinit.channels

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Linking
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.Home
import com.kiwiinit.channels.ui.Tab
import com.kiwiinit.channels.ui.TasksScreen
import com.kiwiinit.channels.ui.LinkScreen
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class ScreensTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    @Test
    fun link() = shoot("link") { LinkScreen(it) }

    @Test
    fun signIn() = shoot("sign-in") { LinkScreen(it, linking = Linking.SigningIn("https://signin.kiwiinit.com/device", "WXYZ-KQPM")) }

    @Test
    fun asking() = shoot("asking") { LinkScreen(it, linking = Linking.Asking) }

    @Test
    fun approve() = shoot("approve") { LinkScreen(it, linking = Linking.Approve("482913")) }

    @Test
    fun check() = shoot("check") { LinkScreen(it, linking = Linking.Check("Jow", "3f9a 0c41 77e2 b8d5 1a06")) }

    @Test
    fun list() = shoot("list") { Home(it, open = {}, tasks = {}) }

    @Test
    fun general() = shoot("general") { ConversationScreen(it, Spot(DEV), back = {}) }

    @Test
    fun leadChat() = shoot("lead-chat") { ConversationScreen(it, Spot(DEV, LEAD_CHAT), back = {}) }

    @Test
    fun needs() = shoot("needs") { Home(it, open = {}, tasks = {}, first = Tab.Needs) }

    @Test
    fun needsReview() = shoot("needs-review", { it.rooms[DEV] = it.rooms.getValue(DEV).copy(asks = emptyList()) }) { Home(it, open = {}, tasks = {}, first = Tab.Needs) }

    @Test
    fun tasks() = shoot("tasks") { TasksScreen(it, DEV, open = {}, back = {}) }

    @Test
    fun room() = shoot("room") { ConversationScreen(it, Spot(DEV, DESIGN_ROOM), back = {}) }

    @Test
    fun settings() = shoot("settings") { Home(it, open = {}, tasks = {}, first = Tab.Settings) }

    @Test
    fun languages() {
        for (language in listOf("ja", "pt-rBR")) {
            val screens: List<Pair<String, @Composable (AppModel) -> Unit>> = listOf(
                "link" to { LinkScreen(it) },
                "list" to { Home(it, open = {}, tasks = {}) },
                "general" to { ConversationScreen(it, Spot(DEV), back = {}) },
                "needs" to { Home(it, open = {}, tasks = {}, first = Tab.Needs) },
                "tasks" to { TasksScreen(it, DEV, open = {}, back = {}) },
                "settings" to { Home(it, open = {}, tasks = {}, first = Tab.Settings) },
            )
            for ((name, screen) in screens) shoot("$language-$name", looks = listOf("light" to "+$language-notnight"), screen = screen)
        }
        RuntimeEnvironment.setQualifiers("+en-notnight")
    }

    private fun shoot(
        name: String,
        prepare: (AppModel) -> Unit = {},
        looks: List<Pair<String, String>> = listOf("light" to "+notnight", "dark" to "+night"),
        screen: @Composable (AppModel) -> Unit,
    ) {
        for ((look, qualifier) in looks) {
            RuntimeEnvironment.setQualifiers(qualifier)
            val model = sample(RuntimeEnvironment.getApplication())
            prepare(model)
            captureRoboImage("build/screens/$name-$look.png") {
                ChannelsTheme {
                    Surface(Modifier.fillMaxSize()) { screen(model) }
                }
            }
        }
    }
}
