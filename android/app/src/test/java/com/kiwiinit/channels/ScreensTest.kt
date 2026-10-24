package com.kiwiinit.channels

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.github.takahirom.roborazzi.captureRoboImage
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationList
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.DetailsScreen
import com.kiwiinit.channels.ui.LinkScreen
import com.kiwiinit.channels.ui.SettingsScreen
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
    @Test
    fun link() = shoot("link") { LinkScreen(it) }

    @Test
    fun list() = shoot("list") { ConversationList(it, open = {}, settings = {}) }

    @Test
    fun general() = shoot("general") { ConversationScreen(it, Spot(DEV), chosen = null, consumeChosen = {}, back = {}, details = {}) }

    @Test
    fun leadChat() = shoot("lead-chat") { ConversationScreen(it, Spot(DEV, LEAD_CHAT), chosen = null, consumeChosen = {}, back = {}, details = {}) }

    @Test
    fun details() = shoot("details") { DetailsScreen(it, DEV, "main", back = {}, choose = {}) }

    @Test
    fun detailsReview() = shoot("details-review", { it.rooms[DEV] = it.rooms.getValue(DEV).copy(asks = emptyList()) }) { DetailsScreen(it, DEV, "main", back = {}, choose = {}) }

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
