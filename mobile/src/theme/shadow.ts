import type { ViewStyle } from "react-native"

import type { Theme } from "./useTheme"

export function shadowStyle(shadow: Theme["shadow"]): ViewStyle {
  return {
    shadowColor: shadow.shade,
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  }
}
