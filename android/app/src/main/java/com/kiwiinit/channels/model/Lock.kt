package com.kiwiinit.channels.model

import android.content.Context
import android.os.SystemClock
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

class Lock(private val app: Context, linked: Boolean) {
    var locked by mutableStateOf(linked)
        private set
    private var leftAt: Long? = null
    private var asking = false

    val available: Boolean
        get() = BiometricManager.from(app).canAuthenticate(ALLOWED) == BiometricManager.BIOMETRIC_SUCCESS

    val biometric: Boolean
        get() = BiometricManager.from(app).canAuthenticate(BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(activity: FragmentActivity): BiometricPrompt =
        BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    asking = false
                    locked = false
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    asking = false
                }
            },
        )

    fun left() {
        leftAt = SystemClock.elapsedRealtime()
    }

    fun back(prompt: BiometricPrompt) {
        val at = leftAt
        if (at != null && SystemClock.elapsedRealtime() - at > GRACE_MS) locked = true
        leftAt = null
        unlock(prompt)
    }

    fun unlock(prompt: BiometricPrompt) {
        if (!locked || asking) return
        if (!available) {
            locked = false
            return
        }
        asking = true
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock your channels")
                .setAllowedAuthenticators(ALLOWED)
                .build(),
        )
    }

    private companion object {
        const val GRACE_MS = 30_000L
        const val ALLOWED = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
    }
}
