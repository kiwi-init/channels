package com.kiwiinit.channels.model

const val MARKS_EVERY_MS = 45_000L

class Raised(val seen: Map<String, Int>, val placeSeen: Map<String, Int>) {
    val isEmpty: Boolean get() = seen.isEmpty() && placeSeen.isEmpty()
}

fun marksOf(code: String, keys: List<String>, seen: Map<String, Int>, placeSeen: Map<String, Int>): Map<String, Int> =
    keys.mapNotNull { key -> (if (key == "main") seen[code] else placeSeen["$code|$key"])?.let { key to it } }.toMap()

fun raisedMarks(code: String, keys: List<String>, merged: Map<String, Int>, seen: Map<String, Int>, placeSeen: Map<String, Int>): Raised {
    val main = mutableMapOf<String, Int>()
    val side = mutableMapOf<String, Int>()
    for ((key, mark) in merged) {
        if (key !in keys) continue
        if (key == "main") {
            if (mark > (seen[code] ?: 0)) main[code] = mark
        } else if (mark > (placeSeen["$code|$key"] ?: 0)) {
            side["$code|$key"] = mark
        }
    }
    return Raised(main, side)
}
