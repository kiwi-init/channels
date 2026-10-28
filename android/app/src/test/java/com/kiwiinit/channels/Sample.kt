package com.kiwiinit.channels

import android.app.Application
import com.kiwiinit.channels.engine.ActivityView
import com.kiwiinit.channels.engine.AskView
import com.kiwiinit.channels.engine.Chosen
import com.kiwiinit.channels.engine.ComputerView
import com.kiwiinit.channels.engine.Connection
import com.kiwiinit.channels.engine.HarnessChoice
import com.kiwiinit.channels.engine.HarnessOptions
import com.kiwiinit.channels.engine.HarnessesOn
import com.kiwiinit.channels.engine.MemberView
import com.kiwiinit.channels.engine.MessageView
import com.kiwiinit.channels.engine.PlaceView
import com.kiwiinit.channels.engine.QuoteView
import com.kiwiinit.channels.engine.ReactionView
import com.kiwiinit.channels.engine.ReviewView
import com.kiwiinit.channels.engine.RoomView
import com.kiwiinit.channels.engine.TaskView
import com.kiwiinit.channels.model.AppModel

const val DEV = "dev"
const val LEAD_CHAT = "dm:jow~lively-swan"

private const val MINUTE = 60_000.0

val COMPUTERS = listOf(
    ComputerView("pk-mac", "xpk-mac", "Jow's MacBook Air", online = true, seenAt = System.currentTimeMillis().toDouble()),
    ComputerView("pk-linux", "xpk-linux", "jwalker-kde", online = false, seenAt = System.currentTimeMillis() - 3 * 60 * MINUTE),
)

val HARNESSES = HarnessesOn(
    harnesses = listOf(
        HarnessChoice(
            "claude",
            "Claude Code",
            face = "claude-code",
            version = "2.4.1",
            start = true,
            options = HarnessOptions(model = true, effort = listOf("low", "medium", "high"), permission = listOf("default", "accept-edits", "plan"), context = listOf(200_000, 1_000_000)),
        ),
        HarnessChoice("codex", "Codex", face = "codex", version = "0.98.0", start = true, options = HarnessOptions(model = true, effort = listOf("low", "medium", "high"))),
        HarnessChoice("opencode", "OpenCode", face = "opencode", mono = true, start = false, why = "Not installed on this computer"),
    ),
    bypass = false,
)

val FOLDERS = listOf("/Users/jow/www/channels", "/Users/jow/www/kiwi-site")

fun sample(app: Application): AppModel {
    val model = AppModel(app)
    model.rooms[DEV] = dev()
    model.rooms["site"] = site()
    return model
}

private fun dev(): RoomView {
    val start = System.currentTimeMillis() - 90 * MINUTE
    fun at(n: Int): Double = start + n * 7 * MINUTE
    val messages = listOf(
        MessageView(1, "lively-swan", at(0), "msg", "Welcome. While Jow writes up what he wants in #android, start here:\n- The app is draft PR #755\n- First step: merge main into its branch"),
        MessageView(2, "jow", at(1), "msg", "lets test it on my phone", mine = true),
        MessageView(
            3,
            "hearty-badger",
            at(2),
            "msg",
            "The app is on your moto g75 (Android 16) and opens on **Link this phone**, with no crash. See https://github.com/kiwi-init/channels/pull/755 or www.example.com",
            reactions = listOf(ReactionView("👍", listOf("jow"), mine = true), ReactionView("🎉", listOf("lively-swan"))),
        ),
        MessageView(4, "gentle-jaguar", at(3), "event", "gentle-jaguar joined", event = true),
        MessageView(5, "jow", at(4), "msg", "Fonts on dark mode are broken in the entire app", mine = true, quote = QuoteView(3, "hearty-badger", "The app is on your moto g75 (Android 16)…")),
        MessageView(6, "hearty-badger", at(5), "msg", "Fixed at the root:\n```\nSurface(Modifier.fillMaxSize()) { … }\n```\nCI is building it, `android / build`."),
        MessageView(7, "lively-swan", at(6), "msg", "Remove the emulator job, or fix it?", choices = listOf("Remove it", "Fix it"), waiting = true, task = 535),
        MessageView(8, "gentle-jaguar", at(7), "msg", "Which way should the Linux keys go?", choices = listOf("KDE wallet", "A file"), chosen = Chosen("KDE wallet", "jow")),
    )
    val side = listOf(
        MessageView(20, "lively-swan", at(8), "msg", "Next: keep fixing the Android app, one small PR each, merged on green."),
        MessageView(21, "jow", at(9), "msg", "ok", mine = true),
        MessageView(
            22,
            "lively-swan",
            at(10),
            "msg",
            "## Today's plan\n1. Native markdown in messages\n2. Release APK, arm64 only\n- [x] Spike\n- [ ] Ship\n\n> Keep Prose for previews and quotes.",
        ),
        MessageView(23, "lively-swan", at(11), "msg", "| Job | State |\n| --- | --- |\n| android / build | green |\n| ci-ok | *waiting* |"),
    )
    val asks = listOf(
        AskView(7, "lively-swan", "Remove the emulator job, or fix it?", at(6), "Decision for you", listOf("Remove it", "Fix it"), task = 535, place = "main"),
        AskView(30, "trusty-vole", "Ship the iPhone build to TestFlight tonight?", at(5), "Question for you", listOf("Yes", "Tomorrow"), task = 24, place = "task:24"),
    )
    return RoomView(
        code = DEV,
        title = "channels-dev",
        me = "jow",
        isOwner = true,
        connection = Connection.Live,
        head = 23,
        whole = true,
        charter = "Build Channels: the desktop app, the phones and the relay. One task, one branch, one PR.",
        lead = "lively-swan",
        members = listOf(
            MemberView("jow", "Jow", "human", owner = true, here = true),
            MemberView("lively-swan", "Teamlead Channels", "agent", role = "lead", lead = true, here = true, activity = ActivityView("working", "Bash"), harness = "claude-code", doing = listOf(535)),
            MemberView("hearty-badger", "Android Builder", "agent", here = true, activity = ActivityView("working"), harness = "claude-code", doing = listOf(543)),
            MemberView("gentle-jaguar", "Codex Builder", "agent", here = true, harness = "codex"),
            MemberView("trusty-vole", "Pi Builder", "agent", harness = "pi", mono = true),
        ),
        messages = messages,
        side = side,
        sideKey = LEAD_CHAT,
        tasks = listOf(
            TaskView(535, "android / device: the emulator step hangs", "doing", owner = "lively-swan"),
            TaskView(543, "Remove the android / device job", "review", owner = "hearty-badger", review = "jow"),
        ),
        asks = asks,
        reviews = listOf(ReviewView(543, "Remove the android / device job (emulator) from CI", "hearty-badger", at(7) + MINUTE)),
        last = messages.last(),
        latest = messages.last(),
        place = "main",
        places = listOf(
            PlaceView("main", "main", "channels-dev", lastSeq = 8, last = messages.last()),
            PlaceView(LEAD_CHAT, "dm", "lively-swan", with = listOf("jow", "lively-swan"), lastSeq = 23, last = side.last()),
            PlaceView("task:24", "task", "T24", task = 24, lastSeq = 30),
        ),
    )
}

private fun site(): RoomView {
    val at = System.currentTimeMillis() - 26 * 60 * MINUTE
    val messages = listOf(
        MessageView(1, "jow", at, "msg", "Can the landing say what Channels is in one line?", mine = true),
        MessageView(2, "quiet-heron", at + 4 * MINUTE, "msg", "Real-time, end-to-end encrypted channels for your agents. Draft is up."),
    )
    return RoomView(
        code = "site",
        title = "kiwi-site",
        me = "jow",
        isOwner = true,
        connection = Connection.Live,
        head = 2,
        whole = true,
        members = listOf(MemberView("jow", "Jow", "human", owner = true, here = true), MemberView("quiet-heron", "Site Builder", "agent")),
        messages = messages,
        last = messages.last(),
        latest = messages.last(),
        places = listOf(PlaceView("main", "main", "kiwi-site", lastSeq = 2, last = messages.last())),
    )
}
