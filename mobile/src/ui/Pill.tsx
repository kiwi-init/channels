import { StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"
import { Text, type Tone } from "./Text"

type PillTone = "decide" | "accent" | "neutral" | "alert"

const INK = { decide: "decide", accent: "accentText", neutral: "ink2", alert: "alert" } as const satisfies Record<PillTone, Tone>

export interface PillProps {
  label: string
  tone?: PillTone
}

export function Pill({ label, tone = "neutral" }: PillProps) {
  const { colors } = useTheme()
  const fill = { decide: colors.decideWash, accent: colors.accentWash, neutral: colors.wash2, alert: colors.wash2 }[tone]
  const ink = INK[tone]
  return (
    <View style={[styles.base, { backgroundColor: fill }]}>
      <Text variant="meta" weight="semibold" tone={ink} numbers numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  base: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 },
})
