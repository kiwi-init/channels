package com.kiwiinit.channels.model

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import androidx.annotation.PluralsRes
import androidx.annotation.StringRes
import androidx.core.content.edit
import java.util.Locale

class Words(private val res: Resources) {
    operator fun invoke(@StringRes id: Int, vararg args: Any): String = res.getString(id, *args)

    fun count(@PluralsRes id: Int, n: Int, vararg args: Any): String = res.getQuantityString(id, n, n, *args)
}

object Language {
    val choices: List<Pair<String, String>> = listOf(
        "en" to "English",
        "pt-BR" to "Português (Brasil)",
        "ja" to "日本語",
        "ko" to "한국어",
        "zh-CN" to "简体中文",
    )

    private const val KEY = "tag"

    private fun prefs(context: Context) = context.getSharedPreferences("language", Context.MODE_PRIVATE)

    fun chosen(context: Context): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.getSystemService(LocaleManager::class.java).applicationLocales.get(0)?.toLanguageTag().orEmpty()
        } else {
            prefs(context).getString(KEY, "").orEmpty()
        }

    fun choose(activity: Activity, tag: String) {
        if (tag == chosen(activity)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.getSystemService(LocaleManager::class.java).applicationLocales = if (tag.isEmpty()) LocaleList.getEmptyLocaleList() else LocaleList.forLanguageTags(tag)
            return
        }
        prefs(activity).edit(commit = true) { putString(KEY, tag) }
        activity.recreate()
    }

    fun wrap(base: Context): Context {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return base
        val tag = prefs(base).getString(KEY, "").orEmpty()
        val locales = if (tag.isEmpty()) Resources.getSystem().configuration.locales else LocaleList.forLanguageTags(tag)
        locales.get(0)?.let(Locale::setDefault)
        if (tag.isEmpty()) return base
        val conf = Configuration(base.resources.configuration)
        conf.setLocales(locales)
        return base.createConfigurationContext(conf)
    }
}
