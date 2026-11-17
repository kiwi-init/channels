package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.Chosen
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
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
class QuestionTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun tappingAnOptionOnAnUnheldQuestionRecordsTheAnswer() {
        val answers = mutableListOf<JsonObject>()
        lateinit var model: AppModel
        model = sample(RuntimeEnvironment.getApplication()) { request ->
            if (request.getValue("op").jsonPrimitive.content != "answer") throw EngineException("only answers here")
            answers += request
            val room = model.rooms.getValue(DEV)
            val answer = request.getValue("text").jsonPrimitive.content
            model.rooms[DEV] = room.copy(messages = room.messages.map { if (it.seq == UNHELD_SEQ) it.copy(waiting = false, chosen = Chosen(answer, room.me)) else it })
            JsonPrimitive(UNHELD_SEQ + 1)
        }
        open(model, waiting = true)
        compose.onNodeWithText("Take it now").assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(1, answers.size)
        val request = answers.single()
        assertEquals("answer", request.getValue("op").jsonPrimitive.content)
        assertEquals(DEV, request.getValue("code").jsonPrimitive.content)
        assertEquals(UNHELD_SEQ.toString(), request.getValue("seq").jsonPrimitive.content)
        assertEquals("Take it now", request.getValue("text").jsonPrimitive.content)
        compose.onNodeWithText("Take it now").assertIsSelected().assertIsNotEnabled()
        compose.onNodeWithText("Wait for a second strike").assertIsNotSelected().assertIsNotEnabled()
        compose.onNodeWithText("Couldn't send · Try again").assertDoesNotExist()
    }

    @Test
    fun aQuestionNotWaitingForYouStaysShut() {
        val answers = mutableListOf<JsonObject>()
        val model = sample(RuntimeEnvironment.getApplication()) { request ->
            if (request.getValue("op").jsonPrimitive.content != "answer") throw EngineException("only answers here")
            answers += request
            JsonPrimitive(0)
        }
        open(model, waiting = false)
        compose.onNodeWithText("Question").assertExists()
        compose.onNodeWithText("Take it now").assertIsNotEnabled().performClick()
        compose.waitForIdle()
        assertEquals(0, answers.size)
    }

    private fun open(model: AppModel, waiting: Boolean) {
        unheldQuestion(model, waiting)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, Spot(DEV), back = {}) }
            }
        }
        compose.waitForIdle()
    }
}
