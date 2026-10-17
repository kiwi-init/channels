import { Image } from "expo-image"
import { Pressable, ScrollView, StyleSheet, View } from "react-native"

import { gifGroups } from "../lib/gifs"
import { useTheme } from "../theme/useTheme"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"

export const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏"] as const

export interface ReactionPickerProps {
  visible: boolean
  onClose: () => void
  onPick: (key: string) => void
}

export function ReactionPicker({ visible, onClose, onPick }: ReactionPickerProps) {
  const { colors, radius } = useTheme()
  const pick = (key: string) => () => {
    onClose()
    onPick(key)
  }
  return (
    <Sheet visible={visible} onClose={onClose} title="React">
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.emoji}>
          {QUICK_EMOJI.map((emoji) => (
            <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`React with ${emoji}`} onPress={pick(emoji)} style={[styles.emojiButton, { backgroundColor: colors.wash2 }]}>
              <Text variant="title">{emoji}</Text>
            </Pressable>
          ))}
        </View>
        {gifGroups.map((group) => (
          <View key={group.reaction} style={styles.group}>
            <Text variant="meta" weight="medium" tone="ink3">
              {group.reaction}
            </Text>
            <View style={styles.grid}>
              {group.items.map((gif) => (
                <Pressable key={gif.key} accessibilityRole="button" accessibilityLabel={`React with ${gif.feeling}`} onPress={pick(gif.key)}>
                  <Image source={gif.source} contentFit="cover" style={[styles.gif, { borderRadius: radius.ctl }]} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: 16, paddingBottom: 16 },
  emoji: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  emojiButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  group: { gap: 6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  gif: { width: 96, height: 96 },
})
