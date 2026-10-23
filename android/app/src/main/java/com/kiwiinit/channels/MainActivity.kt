package com.kiwiinit.channels

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Root
import com.kiwiinit.channels.ui.linkCode

class MainActivity : FragmentActivity() {
    private val model: AppModel get() = (application as ChannelsApp).model
    private lateinit var prompt: BiometricPrompt

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        prompt = model.lock.prompt(this)
        model.boot()
        take(intent)
        lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        model.nudge()
                        model.lock.back(prompt)
                    }
                    Lifecycle.Event.ON_STOP -> model.lock.left()
                    else -> Unit
                }
            },
        )
        setContent {
            ChannelsTheme {
                Root(model) { model.lock.unlock(prompt) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        take(intent)
    }

    private fun take(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme != "kiwi" || uri.host != "link") return
        val code = linkCode(uri.path?.trim('/') ?: return) ?: return
        model.linkWhenReady(code)
    }
}
