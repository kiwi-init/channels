import type { ChannelIcon } from "@mc/protocol.ts"
import { PALETTE } from "@web/lib/characters"
import { Image, StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"
import { hueOf } from "./hue"
import { Text, type Variant } from "./Text"

export type ChannelIconSize = 20 | 28 | 32 | 36 | 40 | 48 | 64

const STEP: Record<ChannelIconSize, Variant> = {
  20: "meta",
  28: "ui",
  32: "ui",
  36: "body",
  40: "title",
  48: "display",
  64: "display",
}

export function letterOf(title: string): string {
  const ch = [...title.trim()][0]
  return ch ? ch.toUpperCase() : "?"
}

export function ChannelIconTile({ icon, title, size }: { icon: ChannelIcon | null; title: string; size: ChannelIconSize }) {
  const theme = useTheme()
  const box = { width: size, height: size, borderRadius: size / 2 }
  if (icon?.kind === "image") {
    return <Image source={{ uri: `data:${icon.mime};base64,${icon.data}` }} style={[styles.tile, box, { backgroundColor: theme.colors.wash2 }]} />
  }
  if (icon?.kind === "emoji") {
    return (
      <View style={[styles.tile, box, { backgroundColor: theme.colors.wash2 }]}>
        <Text variant={STEP[size]}>{icon.emoji}</Text>
      </View>
    )
  }
  const tone = PALETTE[hueOf(title.trim().toLowerCase())]
  return (
    <View style={[styles.tile, box, { backgroundColor: tone.fill }]}>
      <Text variant={STEP[size]} weight="semibold" style={{ color: tone.ink }}>
        {letterOf(title)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  tile: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
})
