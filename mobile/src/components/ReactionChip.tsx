import { isGifReaction } from "@mc/protocol.ts"
import { Image } from "expo-image"
import { StyleSheet, View } from "react-native"

import { gifByKey } from "../lib/gifs"
import { chipLabel, type Chip } from "../lib/reactions"
import { useTheme } from "../theme/useTheme"
import { Text } from "../ui/Text"

export function ReactionChip({ chip }: { chip: Chip }) {
  const { colors, radius } = useTheme()
  const gif = isGifReaction(chip.emoji) ? gifByKey(chip.emoji) : undefined
  if (gif) {
    return (
      <View accessibilityLabel={`${gif.feeling}, from ${chip.who.join(", ")}`} style={chip.mine ? [styles.gifMine, { borderColor: colors.accent, borderRadius: radius.card }] : undefined}>
        <Image source={gif.source} accessibilityLabel={gif.feeling} contentFit="cover" style={[styles.gif, { borderRadius: radius.card }]} />
      </View>
    )
  }
  return (
    <View accessibilityLabel={chipLabel(chip)} style={[styles.chip, { backgroundColor: chip.mine ? colors.accentWash : colors.wash2 }]}>
      <Text variant="stamp" tone={chip.mine ? "accentText" : "ink2"} numbers>
        {chip.emoji}
        {chip.who.length > 1 ? ` ${chip.who.length}` : ""}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: { height: 20, borderRadius: 999, paddingHorizontal: 6, justifyContent: "center" },
  gif: { width: 128, height: 128 },
  gifMine: { borderWidth: 2 },
})
