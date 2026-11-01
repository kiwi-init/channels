package com.kiwiinit.channels.engine

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.json.JSONObject

class EngineException(message: String) : Exception(message)

@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
class Engine(private val app: Context, private val onPush: (Push) -> Unit, private val onLost: () -> Unit) {
    private val host = MutableContextWrapper(app)
    private val main = Handler(Looper.getMainLooper())
    private val reader = Executors.newSingleThreadExecutor()
    private val net = Executors.newSingleThreadExecutor()
    private val calls = ConcurrentHashMap<Int, CompletableDeferred<String>>()
    private val ids = AtomicInteger()
    private var loaded: CompletableDeferred<Unit>? = null
    @Volatile private var dead = false
    val web: WebView = WebView(host)

    init {
        WebStorage.getInstance().deleteAllData()
        WebView.setWebContentsDebuggingEnabled((app.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.settings.cacheMode = WebSettings.LOAD_NO_CACHE
        web.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        web.isFocusable = false
        web.isFocusableInTouchMode = false
        web.addJavascriptInterface(Bridge(), "kiwiAndroid")
        web.webViewClient = Client()
    }

    fun attach(context: Context): WebView {
        (web.parent as? ViewGroup)?.removeView(web)
        host.baseContext = context
        return web
    }

    fun detach() {
        (web.parent as? ViewGroup)?.removeView(web)
        host.baseContext = app
    }

    fun destroy() {
        dead = true
        fail("The engine stopped.")
        detach()
        web.destroy()
        reader.shutdown()
        net.shutdown()
    }

    suspend fun load() {
        for (base in listOf(LOCAL, SECURE)) {
            if (base == SECURE) web.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            val done = CompletableDeferred<Unit>()
            loaded = done
            web.loadDataWithBaseURL(base, PAGE, "text/html", "utf-8", null)
            done.await()
            when (val found = call(PROBE)) {
                "ok" -> return
                "insecure" -> continue
                else -> throw EngineException(found)
            }
        }
        throw EngineException("This phone's WebView won't run Channels' encryption. Update Android System WebView from the Play Store, then open Channels again.")
    }

    suspend fun ask(request: JsonObject): JsonElement {
        val text = call("kiwi.ask(${JSONObject.quote(request.toString())})")
        val reply = try {
            wire.parseToJsonElement(text).jsonObject
        } catch (e: IllegalArgumentException) {
            throw EngineException("The engine answered something this app can't read: ${e.message}")
        }
        if (reply["ok"]?.jsonPrimitive?.booleanOrNull != true) {
            throw EngineException(reply["error"]?.jsonPrimitive?.contentOrNull ?: "Something went wrong.")
        }
        return reply["value"] ?: JsonNull
    }

    private suspend fun call(expr: String): String {
        if (dead) throw EngineException("The engine stopped.")
        val id = ids.incrementAndGet()
        val done = CompletableDeferred<String>()
        calls[id] = done
        withContext(Dispatchers.Main.immediate) {
            web.evaluateJavascript(
                "Promise.resolve().then(() => $expr).then((r) => kiwiAndroid.reply($id, String(r)), (e) => kiwiAndroid.reply($id, JSON.stringify({ ok: false, error: String((e && e.message) || e) })))",
                null,
            )
        }
        return try {
            done.await()
        } finally {
            calls.remove(id)
        }
    }

    private fun fetchForEngine(call: Push.Fetch) {
        val answer = JSONObject().put("id", call.id)
        if (call.url !in SIGN_IN) {
            answer.put("error", "this app only makes its sign-in calls")
        } else {
            try {
                val conn = URL(call.url).openConnection() as HttpURLConnection
                try {
                    conn.requestMethod = "POST"
                    conn.connectTimeout = 20_000
                    conn.readTimeout = 20_000
                    conn.doOutput = true
                    conn.setRequestProperty("content-type", "application/json")
                    conn.setRequestProperty("accept", "application/json")
                    conn.outputStream.use { it.write(call.body.toByteArray()) }
                    val status = conn.responseCode
                    val stream = if (status >= 400) conn.errorStream else conn.inputStream
                    answer.put("status", status).put("body", stream?.bufferedReader()?.use { it.readText() } ?: "")
                } finally {
                    conn.disconnect()
                }
            } catch (e: IOException) {
                answer.put("error", e.message ?: "the sign-in service didn't answer")
            }
        }
        main.post { if (!dead) web.evaluateJavascript("kiwi.fetched(${JSONObject.quote(answer.toString())})", null) }
    }

    private fun fail(why: String) {
        for (call in calls.values) call.completeExceptionally(EngineException(why))
        calls.clear()
    }

    private inner class Bridge {
        @JavascriptInterface
        fun postMessage(text: String) {
            reader.execute {
                val push = try {
                    wire.decodeFromString(Push.serializer(), text)
                } catch (e: IllegalArgumentException) {
                    // A push this build doesn't know (a newer engine's) is skipped; the next room push carries the state again.
                    null
                }
                when (push) {
                    null -> Unit
                    is Push.Fetch -> net.execute { fetchForEngine(push) }
                    else -> {
                        if (push is Push.Log) Log.i("ChannelsEngine", push.line)
                        main.post { onPush(push) }
                    }
                }
            }
        }

        @JavascriptInterface
        fun reply(id: Int, text: String) {
            calls[id]?.complete(text)
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            val url = request.url
            if (url.path != "/engine.js" || "${url.scheme}://${url.authority}/" !in listOf(LOCAL, SECURE)) return null
            return try {
                WebResourceResponse("text/javascript", "utf-8", app.assets.open("engine.js"))
            } catch (e: IOException) {
                // No bundled engine: the probe after loading reports it as a missing engine.
                WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            loaded?.complete(Unit)
            loaded = null
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            dead = true
            fail("The engine stopped.")
            main.post { onLost() }
            return true
        }
    }

    private companion object {
        val SIGN_IN = setOf(
            "https://api.workos.com/user_management/authorize/device",
            "https://api.workos.com/user_management/authenticate",
            "https://github.com/login/device/code",
            "https://github.com/login/oauth/access_token",
        )
        const val LOCAL = "http://localhost/"
        const val SECURE = "https://appassets.androidplatform.net/"
        const val PAGE = "<!doctype html><meta charset=utf-8><title>Channels engine</title><script src=\"engine.js\"></script>"
        const val PROBE =
            """(async () => {
  if (!globalThis.isSecureContext || !globalThis.crypto || !crypto.subtle) return "insecure";
  if (typeof kiwi !== "object") return "The app is missing its engine. Reinstall Channels.";
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    await crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]);
  } catch (e) {
    return "This phone's WebView is too old for Channels' encryption. Update Android System WebView from the Play Store, then open Channels again.";
  }
  return "ok";
})()"""
    }
}
