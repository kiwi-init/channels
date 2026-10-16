import type { ReactNode } from "react"
import { Pressable, StyleSheet, type PressableProps } from "react-native"

import { useTheme } from "../theme/useTheme"

export interface IconButtonProps extends Omit<PressableProps, "style" | "children"> {
  label: string
  active?: boolean
  round?: boolean
  size?: number
  children: ReactNode | ((color: string) => ReactNode)
}

export function IconButton({ label, active, round, size = 40, children, disabled, ...rest }: IconButtonProps) {
  const { colors, radius } = useTheme()
  const color = active ? colors.ink : colors.ink2
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      disabled={disabled}
      hitSlop={Math.max(0, Math.round((44 - size) / 2))}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: round ? size / 2 : radius.ctl, backgroundColor: active ? colors.wash2 : pressed ? colors.wash : "transparent" },
        disabled && styles.disabled,
      ]}
    >
      {typeof children === "function" ? children(color) : children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center", flexShrink: 0 },
  disabled: { opacity: 0.4 },
})
