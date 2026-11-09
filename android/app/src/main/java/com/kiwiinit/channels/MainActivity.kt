package com.kiwiinit.channels

import android.content.Context
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.kiwiinit.channels.model.AppModel
import com.kiwiinit.channels.model.Language
import com.kiwiinit.channels.model.Words
import com.kiwiinit.channels.theme.ChannelsTheme
import com.kiwiinit.channels.ui.Root

class MainActivity : FragmentActivity() {
    private val model: AppModel get() = (application as ChannelsApp).model
    private lateinit var prompt: BiometricPrompt

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(Language.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        model.words = Words(resources)
        prompt = model.lock.prompt(this)
        model.boot()
        lifecycle.addObserver(
            LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_START -> {
                        model.nudge()
                        model.cameToFront()
                        model.lock.back(prompt)
                    }
                    Lifecycle.Event.ON_STOP -> {
                        model.lock.left()
                        model.wentToBack()
                    }
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
}
