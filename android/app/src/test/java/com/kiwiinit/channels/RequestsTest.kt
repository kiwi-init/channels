package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.engine.NeedView
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Spot
import com.kiwiinit.channels.model.needing
import com.kiwiinit.channels.model.needsIn
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.ConversationScreen
import com.kiwiinit.channels.ui.NeedsList
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
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
class RequestsTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private val calls = mutableListOf<JsonObject>()
    private val opened = mutableListOf<Spot>()

    @Test
    fun permissionAndJoinRequestsShowInNeedsYou() {
        show()
        compose.onNodeWithText("git push origin Channels543-device-job").performScrollTo().assertExists()
        compose.onNodeWithText("Allow once").performScrollTo().assertExists()
        compose.onNodeWithText("calm-heron").performScrollTo().assertExists()
        compose.onNodeWithText("Let in").performScrollTo().assertExists()
    }

    @Test
    fun allowOnceAnswersThePermission() {
        show()
        compose.onNodeWithText("Allow once").performScrollTo().performClick()
        compose.waitForIdle()
        val allow = calls.single { it.getValue("op").jsonPrimitive.content == "allow" }
        assertEquals(PERMISSION, allow.getValue("id").jsonPrimitive.content)
        assertEquals(true, allow.getValue("allow").jsonPrimitive.boolean)
    }

    @Test
    fun requestsCountOnTheNeedsYouTab() {
        val model = sample(RuntimeEnvironment.getApplication())
        val before = model.needing
        withRequests(model)
        assertEquals(before + 2, model.needing)
    }

    @Test
    fun aRequestOpensItsConversation() {
        show()
        compose.onNodeWithTag("open-need-$PERMISSION").performScrollTo().performClick()
        assertEquals(listOf(Spot(DEV, "task:543")), opened)
    }

    @Test
    fun turnAwayAnswersTheJoinRequest() {
        show()
        compose.onNodeWithText("Turn away").performScrollTo().performClick()
        compose.waitForIdle()
        val away = calls.single { it.getValue("op").jsonPrimitive.content == "turnAway" }
        assertEquals("join-1", away.getValue("id").jsonPrimitive.content)
    }

    @Test
    fun generalShowsItsRequestsInTheConversation() {
        val model = sample(RuntimeEnvironment.getApplication()) { request ->
            calls += request
            JsonNull
        }
        withRequests(model)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { ConversationScreen(model, Spot(DEV), back = {}) }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("calm-heron").assertExists()
        compose.onNodeWithText("git push origin Channels543-device-job").assertExists()
        compose.onNodeWithText("Turn away").performClick()
        compose.waitForIdle()
        assertEquals("join-1", calls.single { it.getValue("op").jsonPrimitive.content == "turnAway" }.getValue("id").jsonPrimitive.content)
    }

    @Test
    fun aTaskThreadShowsOnlyItsRequests() {
        val model = sample(RuntimeEnvironment.getApplication())
        withRequests(model)
        val room = model.rooms.getValue(DEV)
        assertEquals(listOf(PERMISSION, "join-1"), room.needsIn("main").map { it.id })
        assertEquals(listOf(PERMISSION), room.needsIn("task:543").map { it.id })
        assertEquals(emptyList<String>(), room.needsIn("task:7").map { it.id })
    }

    private fun show() {
        val model = sample(RuntimeEnvironment.getApplication()) { request ->
            calls += request
            JsonNull
        }
        withRequests(model)
        compose.setContent {
            ChannelsTheme {
                Surface(Modifier.fillMaxSize()) { NeedsList(model) { opened += it } }
            }
        }
        compose.waitForIdle()
    }
}

const val PERMISSION = "perm-1"

fun withRequests(model: AppModel) {
    val room = model.rooms.getValue(DEV)
    val now = System.currentTimeMillis().toDouble()
    model.rooms[DEV] = room.copy(
        needs = listOf(
            NeedView(
                kind = "permission",
                id = PERMISSION,
                at = now - 120_000,
                from = "hearty-badger",
                title = "Run a shell command",
                summary = "Push the branch for review",
                code = "git push origin Channels543-device-job",
                canAllow = true,
                task = 543,
            ),
            NeedView(kind = "join", id = "join-1", at = now - 60_000, name = "calm-heron", who = "agent", runs = "Claude Code", machine = "Jow's MacBook", code = "482913"),
        ),
    )
}
