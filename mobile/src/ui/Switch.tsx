import { Pressable, StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"

export interface SwitchProps {
  label: string
  value: boolean
  onValueChange: (value: boolean) => void
  disabled?: boolean
}

const WIDTH = 44
const HEIGHT = 26
const KNOB = 22
const INSET = 2

export function Switch({ label, value, onValueChange, disabled }: SwitchProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={Math.round((44 - HEIGHT) / 2)}
      onPress={() => onValueChange(!value)}
      style={[styles.track, { backgroundColor: value ? colors.accent : colors.wash2 }, disabled && styles.disabled]}
    >
      <View style={[styles.knob, { backgroundColor: colors.accentInk, transform: [{ translateX: value ? WIDTH - KNOB - INSET * 2 : 0 }] }]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  track: { alignSelf: "flex-start", flexShrink: 0, width: WIDTH, height: HEIGHT, borderRadius: 999, padding: INSET },
  knob: { width: KNOB, height: KNOB, borderRadius: 999 },
  disabled: { opacity: 0.4 },
})
