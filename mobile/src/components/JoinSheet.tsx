import { useState } from "react"
import { StyleSheet, View } from "react-native"

import { joinCodeFromInput } from "../lib/deep-link"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"

export const NOT_A_CODE = "That isn’t a join code. Join codes start with mc2-."

export interface JoinSheetProps {
  visible: boolean
  onClose: () => void
  onJoin: (code: string) => void
}

export function joinProblem(text: string): string | null {
  return text.trim() && !joinCodeFromInput(text) ? NOT_A_CODE : null
}

export function JoinSheet({ visible, onClose, onJoin }: JoinSheetProps) {
  const { colors, radius } = useTheme()
  const [text, setText] = useState("")
  const code = joinCodeFromInput(text)
  const problem = joinProblem(text)

  const submit = () => {
    if (!code) return
    onJoin(code)
    setText("")
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Join with a code">
      <View style={styles.column}>
        <Text variant="ui" tone="ink2">
          A code only lets you ask. The owner lets you in after checking a short number with you.
        </Text>
        <TextField
          label="Join code or link"
          value={text}
          onChangeText={setText}
          placeholder="mc2-…"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="go"
          onSubmitEditing={submit}
        />
        {problem ? (
          <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.wash, borderRadius: radius.ctl }]}>
            <Text variant="ui" tone="alert">
              {problem}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title="Ask to join" disabled={!code} onPress={submit} />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  column: { gap: 12, paddingBottom: 8 },
  error: { paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
})
