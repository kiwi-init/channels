package com.kiwiinit.channels

import com.kiwiinit.channels.model.Vault
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VaultTest {
    @Test
    fun aWriteCutShortOnAndroid10StillFindsTheKeys() {
        val app = RuntimeEnvironment.getApplication()
        val base = File(app.noBackupFilesDir, "linked.bin")
        base.writeBytes(ByteArray(40) { it.toByte() })
        assertTrue(base.renameTo(File(base.path + ".bak")))
        assertFalse(base.exists())
        assertTrue(Vault(app).exists())
    }

    @Test
    fun noFileIsNoKeys() {
        assertFalse(Vault(RuntimeEnvironment.getApplication()).exists())
    }
}
