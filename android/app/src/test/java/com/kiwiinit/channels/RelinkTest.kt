package com.kiwiinit.channels

import android.os.Looper
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Linking
import com.kiwiinit.channels.model.Phase
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RelinkTest {
    @Test
    fun linkAgainClosesItsSheetOnceTheKeyMatches() {
        val saved = buildJsonObject {
            put("relay", "https://channels.kiwiinit.com")
            put("person", buildJsonObject { put("name", "Jow") })
            putJsonArray("seats") {}
        }
        val model = AppModel(RuntimeEnvironment.getApplication()) { request ->
            when (request.getValue("op").jsonPrimitive.content) {
                "enrollFinish" -> saved
                "start" -> JsonPrimitive(1)
                else -> JsonNull
            }
        }
        model.relinkAsked = true
        model.keepLink()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(Phase.Ready, model.phase)
        assertEquals(Linking.Idle, model.linking)
        assertFalse(model.relinking)
    }
}
