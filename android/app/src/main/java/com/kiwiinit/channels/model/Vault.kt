package com.kiwiinit.channels.model

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class Vault(context: Context) {
    private val file = AtomicFile(File(context.noBackupFilesDir, "linked.bin"))

    fun exists(): Boolean = file.baseFile.exists()

    fun load(): ByteArray? {
        if (!exists()) return null
        return try {
            val sealed = file.readFully()
            if (sealed.size <= IV) return null
            val cipher = Cipher.getInstance(MODE)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG, sealed, 0, IV))
            cipher.doFinal(sealed, IV, sealed.size - IV)
        } catch (e: GeneralSecurityException) {
            // A key the keystore lost (a restore to another phone, a wiped lock screen) can't open it: this phone links again.
            null
        } catch (e: IOException) {
            // An unreadable file is the same as none: this phone links again.
            null
        }
    }

    fun save(data: ByteArray): Boolean {
        val out = try {
            file.startWrite()
        } catch (e: IOException) {
            // Nothing was written; the keys stay as they were and the next save tries again.
            return false
        }
        return try {
            val cipher = Cipher.getInstance(MODE)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            out.write(cipher.iv)
            out.write(cipher.doFinal(data))
            file.finishWrite(out)
            true
        } catch (e: GeneralSecurityException) {
            // The keystore refused: the old file stays whole and the next save tries again.
            file.failWrite(out)
            false
        } catch (e: IOException) {
            // The disk refused: the old file stays whole and the next save tries again.
            file.failWrite(out)
            false
        }
    }

    fun wipe() {
        file.delete()
        try {
            store().deleteEntry(ALIAS)
        } catch (e: GeneralSecurityException) {
            // The file is gone already; a key left behind opens nothing.
        } catch (e: IOException) {
            // The file is gone already; a key left behind opens nothing.
        }
    }

    private fun store(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun key(): SecretKey {
        (store().getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "channels.linked"
        const val MODE = "AES/GCM/NoPadding"
        const val IV = 12
        const val TAG = 128
    }
}
