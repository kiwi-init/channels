package com.kiwiinit.channels

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.LaunchSeen
import com.kiwiinit.channels.model.Linking
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ComputerList
import com.kiwiinit.channels.ui.ConversationList
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.DetailsScreen
import com.kiwiinit.channels.ui.FolderList
import com.kiwiinit.channels.ui.HarnessList
import com.kiwiinit.channels.ui.LinkScreen
import com.kiwiinit.channels.ui.Loaded
import com.kiwiinit.channels.ui.NewAgentFrame
import com.kiwiinit.channels.ui.OptionsForm
import com.kiwiinit.channels.ui.SettingsScreen
import com.kiwiinit.channels.ui.StartedList
import com.kiwiinit.channels.ui.Starting
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
    fun list() = shoot("list") { ConversationList(it, open = {}, settings = {}) }

    @Test
    fun general() = shoot("general") { ConversationScreen(it, Spot(DEV), chosen = null, consumeChosen = {}, back = {}, details = {}) }

    @Test
    fun leadChat() = shoot("lead-chat") { ConversationScreen(it, Spot(DEV, LEAD_CHAT), chosen = null, consumeChosen = {}, back = {}, details = {}) }

    @Test
    fun details() = shoot("details") { DetailsScreen(it, DEV, "main", back = {}, choose = {}, newAgent = {}) }

    @Test
    fun detailsReview() = shoot("details-review", { it.rooms[DEV] = it.rooms.getValue(DEV).copy(asks = emptyList()) }) { DetailsScreen(it, DEV, "main", back = {}, choose = {}, newAgent = {}) }

    @Test
    fun newAgentComputers() = shoot("new-agent-computers") {
        NewAgentFrame("New agent", root = true, back = {}) { ComputerList(it.rooms.getValue(DEV), Loaded.Ready(COMPUTERS), retry = {}, pick = {}) }
    }

    @Test
    fun newAgentHarness() = shoot("new-agent-harness") {
        NewAgentFrame("Harness", root = false, back = {}) { HarnessList(COMPUTERS.first(), Loaded.Ready(HARNESSES), retry = {}, pick = { _, _ -> }) }
    }

    @Test
    fun newAgentFolder() = shoot("new-agent-folder") {
        NewAgentFrame("Folder", root = false, back = {}) { FolderList(COMPUTERS.first(), Loaded.Ready(FOLDERS), retry = {}, pick = {}) }
    }

    @Test
    fun newAgentOptions() = shoot("new-agent-options") {
        NewAgentFrame("Options", root = false, back = {}) { OptionsForm(COMPUTERS.first(), HARNESSES.harnesses.first(), HARNESSES.bypass, FOLDERS.first(), start = {}) }
    }

    @Test
    fun newAgentStarted() = shoot("new-agent-started") {
        NewAgentFrame("New agent", root = false, back = null) {
            StartedList(it.rooms.getValue(DEV), COMPUTERS.first(), HARNESSES.harnesses.first(), Starting.Started("launch-1"), LaunchSeen("joined", "swift-otter"), retry = {}, close = {})
        }
    }

    @Test
    fun settings() = shoot("settings") { SettingsScreen(it) {} }

    private fun shoot(name: String, prepare: (AppModel) -> Unit = {}, screen: @Composable (AppModel) -> Unit) {
        for ((look, qualifier) in listOf("light" to "+notnight", "dark" to "+night")) {
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
