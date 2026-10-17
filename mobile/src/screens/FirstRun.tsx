import { useState } from "react"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"
import { toast } from "../ui/Toast"

export function FirstRun({ onContinue, onLink }: { onContinue: (name: string) => Promise<void> | void; onLink?: () => void }) {
  const { colors } = useTheme()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const ready = name.trim().length > 0 && !busy

  const go = async () => {
    setBusy(true)
    try {
      await onContinue(name.trim())
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start", "error")
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.body}>
        <Text variant="display">Kiwi</Text>
        <Text tone="ink2" style={styles.lead}>
          Your name is how people in a channel see you. It stays on this phone with your keys.
        </Text>
        <TextField label="Your name" value={name} onChangeText={setName} autoFocus autoCapitalize="words" returnKeyType="done" onSubmitEditing={() => ready && void go()} />
        <Button title="Continue" disabled={!ready} onPress={() => void go()} />
        {onLink ? <Button title="I already use Kiwi on a computer: link this phone" variant="ghost" onPress={onLink} /> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  lead: { marginBottom: 8 },
})
