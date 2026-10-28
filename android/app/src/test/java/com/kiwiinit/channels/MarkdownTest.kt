package com.kiwiinit.channels

import android.view.View
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.github.takahirom.roborazzi.RobolectricDeviceQualifiers
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Inks
import com.kiwiinit.channels.ui.Markdown
import com.kiwiinit.channels.ui.Renderer
import com.swmansion.enriched.markdown.EnrichedMarkdown
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = RobolectricDeviceQualifiers.Pixel7)
class MarkdownTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private val inks = Inks(Color.Black, Color.Blue, Color.LightGray, false)

    @Test
    fun aLoadedParserDrawsTheMessageNatively() {
        show(Renderer(load = { true }, parse = { Any() }))
        compose.onNodeWithText("Native or Prose").assertDoesNotExist()
        assertEquals(1, natives())
    }

    @Test
    fun aParserThatWontLoadDrawsTheMessageWithProse() {
        show(Renderer(load = { throw UnsatisfiedLinkError("no enriched_markdown_parser") }, parse = { Any() }))
        compose.onNodeWithText("Native or Prose").assertExists()
        assertEquals(0, natives())
    }

    @Test
    fun aMessageTheParserRejectsIsDrawnWithProse() {
        show(Renderer(load = { true }, parse = { throw IllegalStateException("bad") }))
        compose.onNodeWithText("Native or Prose").assertExists()
        assertEquals(0, natives())
    }

    @Test
    fun screenshotsOnTheJvmGoThroughProse() {
        assertFalse(Renderer.device.native("**Native or Prose**"))
    }

    private fun show(renderer: Renderer) {
        compose.setContent {
            ChannelsTheme { Markdown("**Native or Prose**", inks, renderer = renderer) }
        }
        compose.waitForIdle()
    }

    private fun natives(): Int = views(compose.activity.window.decorView).count { it is EnrichedMarkdown }

    private fun views(view: View): List<View> =
        listOf(view) + if (view is ViewGroup) (0 until view.childCount).flatMap { views(view.getChildAt(it)) } else emptyList()
}
