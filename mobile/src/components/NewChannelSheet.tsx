import { useState } from "react"
import { Pressable, StyleSheet, View } from "react-native"

import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Sheet } from "../ui/Sheet"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"

export const MAX_NAME = 60
export const UNTITLED = "Untitled channel"

export interface NewChannelSheetProps {
  visible: boolean
  onClose: () => void
  onCreate: (name: string) => Promise<string>
  onCreated: (code: string) => void
  onJoin?: () => void
}

export function nameProblem(name: string): string | null {
  return name.trim().length > MAX_NAME ? `Keep the name to ${MAX_NAME} characters or fewer.` : null
}

function failure(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function NewChannelSheet({ visible, onClose, onCreate, onCreated, onJoin }: NewChannelSheetProps) {
  const { colors, radius } = useTheme()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async () => {
    const problem = nameProblem(name)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      const code = await onCreate(name.trim() || UNTITLED)
      setName("")
      onCreated(code)
    } catch (err) {
      setError(failure(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="New channel">
      <View style={styles.column}>
        <Text variant="ui" tone="ink2">
          You own it and approve everyone who joins. Only members can read its name.
        </Text>
        <TextField
          label="Channel name"
          value={name}
          onChangeText={setName}
          placeholder="payments-refactor"
          maxLength={MAX_NAME + 20}
          autoComplete="off"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void create()}
          editable={!busy}
        />
        {error ? (
          <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.wash, borderRadius: radius.ctl }]}>
            <Text variant="ui" tone="alert">
              {error}
            </Text>
          </View>
        ) : null}
        <View style={styles.actions}>
          {onJoin ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Have a code? Join" onPress={onJoin} style={styles.join}>
              <Text variant="ui" weight="medium" tone="accentText">
                Have a code? Join
              </Text>
            </Pressable>
          ) : (
            <View style={styles.join} />
          )}
          <Button title="Cancel" variant="secondary" onPress={onClose} />
          <Button title={busy ? "Creating…" : "Create channel"} disabled={busy} onPress={() => void create()} />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  column: { gap: 12, paddingBottom: 8 },
  error: { paddingHorizontal: 12, paddingVertical: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  join: { flex: 1 },
})
