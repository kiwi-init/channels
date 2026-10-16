import type { ReactNode } from "react"
import { Pressable, StyleSheet, View, type PressableProps } from "react-native"

import { useTheme } from "../theme/useTheme"
import { Text, type Tone } from "./Text"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"
type ButtonSize = "sm" | "md" | "lg"

const TONE = { primary: "accentInk", secondary: "ink", ghost: "ink2", danger: "alert" } as const satisfies Record<ButtonVariant, Tone>
const HEIGHT: Record<ButtonSize, number> = { sm: 32, md: 40, lg: 48 }
const PAD: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 22 }
const HIT: Record<ButtonSize, number> = { sm: 6, md: 2, lg: 0 }

export interface ButtonProps extends Omit<PressableProps, "style" | "children"> {
  title: string
  variant?: ButtonVariant
  size?: ButtonSize
  leading?: ReactNode
}

export function Button({ title, variant = "primary", size = "md", leading, disabled, accessibilityLabel, ...rest }: ButtonProps) {
  const { colors, radius } = useTheme()
  const fill = { primary: colors.accent, secondary: colors.wash2, ghost: "transparent", danger: "transparent" }[variant]
  const tone = TONE[variant]
  const pressedFill = variant === "primary" ? colors.accent : variant === "secondary" ? colors.edgeStrong : colors.wash
  return (
    <Pressable
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={HIT[size]}
      style={({ pressed }) => [
        styles.base,
        { height: HEIGHT[size], paddingHorizontal: PAD[size], borderRadius: size === "sm" ? radius.row : radius.ctl, backgroundColor: pressed ? pressedFill : fill },
        pressed && variant === "primary" && styles.pressedPrimary,
        disabled && styles.disabled,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <Text variant={size === "lg" ? "body" : "ui"} weight="medium" tone={tone} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "flex-start", flexShrink: 0 },
  leading: { marginRight: 6 },
  pressedPrimary: { opacity: 0.8 },
  disabled: { opacity: 0.4 },
})
