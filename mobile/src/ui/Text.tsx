import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native"

import type { Theme } from "../theme/useTheme"
import { useTheme } from "../theme/useTheme"

export type Variant = "stamp" | "meta" | "ui" | "body" | "title" | "display"
export type Weight = "regular" | "medium" | "semibold"
type Tone = "ink" | "ink2" | "ink3" | "accentText" | "alert" | "decide" | "live" | "accentInk" | "bubbleMeInk" | "bubbleThemInk"

export const FAMILY: Record<Weight, string> = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
}

const DEFAULT_WEIGHT: Record<Variant, Weight> = {
  stamp: "regular",
  meta: "regular",
  ui: "regular",
  body: "regular",
  title: "semibold",
  display: "semibold",
}

interface Look {
  variant?: Variant
  weight?: Weight
  tone?: Tone
  mono?: boolean
  numbers?: boolean
}

export interface TextProps extends RNTextProps, Look {}

function textStyle(theme: Theme, { variant = "body", weight, tone = "ink", mono, numbers }: Look = {}): TextStyle {
  return {
    ...theme.type[variant],
    color: theme.colors[tone],
    fontFamily: mono ? theme.mono : FAMILY[weight ?? DEFAULT_WEIGHT[variant]],
    ...(numbers ? { fontVariant: ["tabular-nums"] } : {}),
  }
}

export function Text({ variant, weight, tone, mono, numbers, style, ...rest }: TextProps) {
  const theme = useTheme()
  return <RNText {...rest} style={[textStyle(theme, { variant, weight, tone, mono, numbers }), style]} />
}
