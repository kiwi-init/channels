package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.EngineException
import com.kiwiinit.channels.engine.StepAnswer
import com.kiwiinit.channels.engine.StepOutcome
import com.kiwiinit.channels.engine.StepView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.STEP_NOTE
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
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
class StepTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private val sent = mutableListOf<JsonObject>()

    private fun answering(answer: (AppModel, JsonObject) -> JsonElement): AppModel {
        lateinit var model: AppModel
        model = sample(RuntimeEnvironment.getApplication()) { request ->
            if (request.getValue("op").jsonPrimitive.content != "answerStep") throw EngineException("only step replies here")
            sent += request
            answer(model, request)
        }
        return model
    }

    private fun answered(model: AppModel, request: JsonObject): JsonElement {
        val room = model.rooms.getValue(DEV)
        val outcome = when (request.getValue("reply").jsonObject.getValue("outcome").jsonPrimitive.content) {
            "done" -> StepOutcome.Done
            "cant" -> StepOutcome.Cant
            else -> StepOutcome.NotNeeded
        }
        model.rooms[DEV] = room.copy(messages = room.messages.map { if (it.seq == STEP_SEQ) it.copy(waiting = false, stepAnswer = StepAnswer(room.me, outcome)) else it })
        return JsonPrimitive(STEP_SEQ + 1)
    }

    @Test
    fun tappingDoneSendsTheStepReplyAndTheCardComesBackAnswered() {
        open(answering(::answered), waiting = true)
        compose.onNodeWithText("A step for you").assertExists()
        compose.onNodeWithText("Done").assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(1, sent.size)
        val request = sent.single()
        assertEquals(DEV, request.getValue("code").jsonPrimitive.content)
        assertEquals(STEP_SEQ.toString(), request.getValue("seq").jsonPrimitive.content)
        assertEquals(JsonObject(mapOf("outcome" to JsonPrimitive("done"))), request.getValue("reply"))
        compose.onNodeWithText("You · Done").assertExists()
        compose.onNodeWithText("Not needed").assertDoesNotExist()
        compose.onNodeWithText("Couldn't send · Try again").assertDoesNotExist()
    }

    @Test
    fun cantDoItNeedsAReasonAndSendsIt() {
        open(answering(::answered), waiting = true)
        compose.onNodeWithText("Can't do it").performClick()
        compose.onNodeWithText("Send").assertIsNotEnabled()
        compose.onNodeWithTag(STEP_NOTE).performTextInput("The Mac is away")
        compose.onNodeWithText("Send").assertIsEnabled().performClick()
        compose.waitForIdle()
        val reply = sent.single().getValue("reply").jsonObject
        assertEquals("cant", reply.getValue("outcome").jsonPrimitive.content)
        assertEquals("The Mac is away", reply.getValue("reason").jsonPrimitive.content)
        compose.onNodeWithText("You · Can't do it").assertExists()
    }

    @Test
    fun aStepReplyThatDoesNotSendSaysSoAndStaysOpen() {
        open(answering { _, _ -> throw EngineException("offline") }, waiting = true)
        compose.onNodeWithText("Done").performClick()
        compose.waitForIdle()
        assertEquals(1, sent.size)
        compose.onNodeWithText("Couldn't send · Try again").assertExists()
        compose.onNodeWithText("Done").assertIsEnabled()
    }

    @Test
    fun aStepNotWaitingForYouOffersNoActions() {
        open(answering(::answered), waiting = false)
        compose.onNodeWithText("Step").assertExists()
        compose.onNodeWithText("Done").assertDoesNotExist()
        compose.onNodeWithText("Can't do it").assertDoesNotExist()
        assertEquals(0, sent.size)
    }

    @Test
    fun anAnsweredStepShowsWhoAnsweredAndTakesNoAction() {
        open(answering(::answered), waiting = false, answer = StepAnswer("jow", StepOutcome.NotNeeded))
        compose.onNodeWithText("You · Not needed").assertExists()
        compose.onNodeWithText("Done").assertDoesNotExist()
    }

    @Test
    fun aStepWithOnlyACommandOrOnlyALinkStillShowsIt() {
        open(answering(::answered), waiting = true, step = StepView(why = "CI has no signing key.", needsPerson = "your Mac", run = listOf("bun run notarize")))
        compose.onNodeWithText("bun run notarize").assertExists()
    }

    @Test
    fun aStepWithOnlyALinkStillShowsIt() {
        open(answering(::answered), waiting = true, step = StepView(why = "The store wants a person.", needsPerson = "your account", links = listOf("https://example.com/review")))
        compose.onNodeWithText("https://example.com/review").assertExists()
    }

    @Test
    fun aLinkNoAppOpensDoesNothing() {
        val tried = mutableListOf<String>()
        val noApp = object : UriHandler {
            override fun openUri(uri: String) {
                tried += uri
                throw IllegalArgumentException("Can't open $uri.")
            }
        }
        open(answering(::answered), waiting = true, step = StepView(why = "Read the setup notes.", needsPerson = "you", links = listOf("docs/setup.md")), links = noApp)
        compose.onNodeWithText("docs/setup.md").performClick()
        compose.waitForIdle()
        assertEquals(listOf("docs/setup.md"), tried)
        compose.onNodeWithText("Done").assertIsEnabled()
    }

    private fun open(model: AppModel, waiting: Boolean, step: StepView = SIGN_STEP, answer: StepAnswer? = null, links: UriHandler? = null) {
        stepAsked(model, waiting, step, answer)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) {
                    if (links == null) {
                        ConversationScreen(model, Spot(DEV), back = {})
                    } else {
                        CompositionLocalProvider(LocalUriHandler provides links) { ConversationScreen(model, Spot(DEV), back = {}) }
                    }
                }
            }
        }
        compose.waitForIdle()
    }
}
