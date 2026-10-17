import type { Message } from "@mc/protocol.ts"
import * as Clipboard from "expo-clipboard"
import { Pressable, StyleSheet } from "react-native"

import { useTheme } from "../theme/useTheme"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { toast } from "../ui/Toast"

export interface MessageMenuProps {
  message: Message | null
  onClose: () => void
  onReply?: (m: Message) => void
  onReact?: (m: Message) => void
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.action, { borderBottomColor: colors.line }]}>
      <Text variant="body">{label}</Text>
    </Pressable>
  )
}

export function MessageMenu({ message, onClose, onReply, onReact }: MessageMenuProps) {
  const choose = (run: (m: Message) => void) => () => {
    if (!message) return
    onClose()
    run(message)
  }
  return (
    <Sheet visible={message !== null} onClose={onClose}>
      {onReply ? <Action label="Reply" onPress={choose(onReply)} /> : null}
      {onReact ? <Action label="React" onPress={choose(onReact)} /> : null}
      <Action
        label="Copy text"
        onPress={choose((m) => {
          void Clipboard.setStringAsync(m.body).then(() => toast("Copied"))
        })}
      />
    </Sheet>
  )
}

const styles = StyleSheet.create({
  action: { paddingVertical: 14, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
})
