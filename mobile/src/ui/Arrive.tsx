import { useEffect, useState, type ReactNode } from "react"
import { AccessibilityInfo, Animated, Easing } from "react-native"

const MS = 180

export function Arrive({ active, from, children }: { active: boolean; from: "left" | "right"; children: ReactNode }) {
  const [progress] = useState(() => new Animated.Value(active ? 0 : 1))

  useEffect(() => {
    if (!active) return
    let live = true
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!live) return
      if (reduced) return progress.setValue(1)
      Animated.timing(progress, { toValue: 1, duration: MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    })
    return () => {
      live = false
    }
  }, [active, progress])

  const shift = progress.interpolate({ inputRange: [0, 1], outputRange: [from === "right" ? 12 : -12, 0] })
  return (
    <Animated.View testID="arrive" style={{ opacity: progress, transform: [{ translateX: shift }] }}>
      {children}
    </Animated.View>
  )
}
