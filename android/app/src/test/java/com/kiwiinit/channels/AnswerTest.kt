package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.model.Attached
import com.kiwiinit.channels.model.Draft
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Dock
import com.kiwiinit.channels.ui.NeedsList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
class AnswerTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    @Test
    fun aTypedAnswerThatDoesNotSendStaysWithWhy() {
        details()
        compose.onAllNodesWithText("Something else")[0].performClick()
        compose.onNode(hasSetTextAction()).performClick().performTextInput("Not tonight")
        compose.onNodeWithContentDescription("Send answer").performClick()
        compose.waitForIdle()
        compose.onNode(hasSetTextAction()).assert(hasText("Not tonight"))
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
    }

    @Test
    fun aChoiceThatDoesNotSendSaysSo() {
        details()
        compose.onNodeWithText("Remove it").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
    }

    private val sent = mutableListOf<JsonObject>()

    @Test
    fun anAnswerWithAPhotoAnswersTheQuestionThenSendsThePhoto() {
        var answeringNow = true
        withPhoto { answeringNow = false }
        compose.onNode(hasSetTextAction()).performTextInput("this one")
        compose.onNodeWithContentDescription("Send").performClick()
        compose.waitForIdle()
        assertEquals(listOf("answer", "send"), sent.map { it.getValue("op").jsonPrimitive.content })
        assertEquals("this one", sent[0].getValue("text").jsonPrimitive.content)
        assertEquals(ASK_SEQ.toString(), sent[0].getValue("seq").jsonPrimitive.content)
        assertEquals("", sent[1].getValue("body").jsonPrimitive.content)
        assertEquals(1, (sent[1].getValue("imgs") as JsonArray).size)
        assertFalse(answeringNow)
    }

    @Test
    fun aPhotoAloneDoesNotAnswerAQuestion() {
        withPhoto {}
        compose.onNodeWithContentDescription("Attached photo").assertExists()
        compose.onNodeWithContentDescription("Send").assertDoesNotExist()
        assertEquals(0, sent.size)
    }

    private fun withPhoto(clearAnswer: () -> Unit) {
        val model = sample(RuntimeEnvironment.getApplication()) { request ->
            sent += request
            if (request.getValue("op").jsonPrimitive.content == "send") JsonPrimitive(900) else JsonNull
        }
        val spot = Spot(DEV)
        model.keep(Draft(attached = listOf(Attached("p1", ImageBitmap(4, 4), ByteArray(8), "image/jpeg"))), spot)
        val room = model.rooms.getValue(DEV)
        val ask = room.asks.first { it.seq == ASK_SEQ }
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) {
                    Dock(model, room, spot, replyTo = null, answering = ask, sendingBack = null, focus = FocusRequester(), clearReply = {}, clearAnswer = clearAnswer, clearSendBack = {})
                }
            }
        }
        compose.waitForIdle()
    }

    private fun details() {
        val model = sample(RuntimeEnvironment.getApplication())
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { NeedsList(model) }
            }
        }
        compose.waitForIdle()
    }

    private companion object {
        const val ASK_SEQ = 7
    }
}
