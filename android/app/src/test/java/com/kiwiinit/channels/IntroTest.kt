package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.PlaceView
import com.kiwiinit.channels.model.AppModel
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
class IntroTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun anEmptyTaskThreadIntroducesTheTaskNotTheLead() {
        open(Spot(DEV, "task:543"))
        compose.onNodeWithText("Lead of channels-dev").assertDoesNotExist()
        compose.onNodeWithText("Android Builder · In review in channels-dev").assertExists()
        compose.onNodeWithText("The start of this task's thread").assertExists()
    }

    @Test
    fun anEmptyRoomIntroducesTheRoomNotTheLead() {
        open(Spot(DEV, EMPTY_ROOM))
        compose.onNodeWithText("Lead of channels-dev").assertDoesNotExist()
        compose.onNodeWithText("No messages yet").assertExists()
    }

    @Test
    fun theLeadChatStillIntroducesTheLead() {
        open(Spot(DEV, LEAD_CHAT), keepMessages = false)
        compose.onNodeWithText("Lead of channels-dev").assertExists()
    }

    private fun open(spot: Spot, keepMessages: Boolean = true) {
        val model = sample(RuntimeEnvironment.getApplication())
        emptyRoom(model)
        if (!keepMessages) model.rooms[DEV] = model.rooms.getValue(DEV).copy(side = emptyList())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, spot, back = {}) }
            }
        }
        compose.waitForIdle()
    }
}

const val EMPTY_ROOM = "room:ideas01"

fun emptyRoom(model: AppModel) {
    val room = model.rooms.getValue(DEV)
    model.rooms[DEV] = room.copy(places = room.places + PlaceView(EMPTY_ROOM, "room", "ideas"))
}
