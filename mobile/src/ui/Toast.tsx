import { useSyncExternalStore } from "react"
import { AccessibilityInfo, StyleSheet, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { shadowStyle } from "../theme/shadow"
import { useTheme } from "../theme/useTheme"
import { Text } from "./Text"

type ToastTone = "error"

interface ToastItem {
  id: number
  text: string
  tone?: ToastTone
}

const SHOWN_MS = 2200
const ERROR_MS = 6000
const KEPT = 3

let toasts: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(text: string, tone?: ToastTone): void {
  const id = nextId++
  toasts = [...toasts.slice(-(KEPT - 1)), { id, text, tone }]
  emit()
  void AccessibilityInfo.announceForAccessibility(text)
  setTimeout(
    () => {
      toasts = toasts.filter((t) => t.id !== id)
      emit()
    },
    tone === "error" ? ERROR_MS : SHOWN_MS
  )
}

export function clearToasts(): void {
  toasts = []
  emit()
}

function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    () => toasts
  )
}

export function Toaster() {
  const items = useToasts()
  const { colors, radius, shadow } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 24 }]}>
      {items.map((t) => (
        <View
          key={t.id}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.item, shadowStyle(shadow), { borderRadius: radius.card, backgroundColor: t.tone === "error" ? colors.alertFill : colors.ink }]}
        >
          <Text variant="ui" weight="medium" tone={t.tone === "error" ? "accentInk" : "bubbleMeInk"}>
            {t.text}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 8, paddingHorizontal: 16 },
  item: { maxWidth: 440, paddingHorizontal: 14, paddingVertical: 9 },
})
