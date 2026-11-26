package com.kiwiinit.channels

import androidx.activity.ComponentActivity
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Face
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34])
class FaceTest {
    private val compose = createAndroidComposeRule<ComponentActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(Registered).around(compose)

    private val red = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf8AABniCTcAAAAHdElNRQfqCxoNGBXUYftPAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTI2VDEzOjI0OjIxKzAwOjAw3lXmhQAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0yNlQxMzoyNDoyMSswMDowMK8IXjkAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMjZUMTM6MjQ6MjErMDA6MDD4HX/mAAAAC0lEQVQI12NgQAUAABAAAaHFIcEAAAAASUVORK5CYII="

    private fun middle(member: MemberView): Int {
        compose.setContent { ChannelsTheme { Face(member.name, member, 40.dp) } }
        val pixels = compose.onRoot().captureToImage().toPixelMap()
        val color = pixels[pixels.width / 2, pixels.height / 2]
        return (color.red * 255).toInt() shl 16 or ((color.green * 255).toInt() shl 8) or (color.blue * 255).toInt()
    }

    @Test
    fun aPersonWithAPictureShowsIt() {
        assertEquals(0xFF0000, middle(MemberView("jow", "Jow", "human", picture = red)))
    }

    @Test
    fun aPersonWithoutOneShowsInitials() {
        assertNotEquals(0xFF0000, middle(MemberView("jow", "Jow", "human")))
    }

    @Test
    fun anAgentNeverShowsAPicture() {
        assertNotEquals(0xFF0000, middle(MemberView("dev", "Dev", "agent", picture = red)))
    }

    @Test
    fun aGarbledPictureFallsBackToInitials() {
        assertNotEquals(0xFF0000, middle(MemberView("jow", "Jow", "human", picture = "not base64 at all")))
    }
}
