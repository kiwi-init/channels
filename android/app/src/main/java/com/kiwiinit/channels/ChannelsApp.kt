package com.kiwiinit.channels

import android.app.Application
import com.kiwiinit.channels.model.AppModel

class ChannelsApp : Application() {
    val model: AppModel by lazy { AppModel(this) }
}
