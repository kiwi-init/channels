import type { Color } from "@mc/protocol.ts"
import { PALETTE } from "@web/lib/characters"
import { initials } from "@web/lib/format"
import { StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"
import { RobotAvatar } from "./RobotAvatar"
import { Text } from "./Text"

export interface MonogramProps {
  name: string
  hue?: string
  agent?: boolean
  size?: number
  online?: boolean
  color?: Color | null
  working?: boolean
}

export function Monogram({ name, hue, agent, size = 28, online, color, working }: MonogramProps) {
  const theme = useTheme()
  const tone = color ? PALETTE[color] : null
  const letters = initials(name)
  const dot = Math.max(7, Math.round(size * 0.26))
  return (
    <View style={{ width: size, height: size }}>
      {agent ? (
        <View style={[styles.tile, { width: size, height: size, borderRadius: size / 2 }, working && { borderWidth: 2, borderColor: theme.colors.doing }]}>
          <RobotAvatar name={hue ?? name} size={working ? size - 4 : size} />
        </View>
      ) : (
        <View
          style={[
            styles.tile,
            { width: size, height: size, borderRadius: size / 2, backgroundColor: tone ? tone.fill : theme.colors.wash2 },
            working && { borderWidth: 2, borderColor: theme.colors.doing },
          ]}
        >
          <Text weight="semibold" style={{ color: tone ? tone.ink : theme.colors.ink2, fontSize: Math.round(size * (letters.length > 1 ? 0.38 : 0.44)) }}>
            {letters}
          </Text>
        </View>
      )}
      {online ? <View style={[styles.dot, { width: dot, height: dot, backgroundColor: theme.colors.live, borderColor: theme.colors.canvas }]} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", right: -2, bottom: -2, borderRadius: 999, borderWidth: 2 },
})
