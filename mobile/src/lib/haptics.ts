import * as Haptics from "expo-haptics"

export function lightTap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}
