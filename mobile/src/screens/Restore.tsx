import { useState } from "react"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import type { BackupEnvelope } from "@mc/backup.ts"

import type { Restored } from "../lib/account"
import type { SignInStep } from "../lib/signIn"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"

export interface RestoreProps {
  signIn: (on: (step: SignInStep) => void) => Promise<string>
  fetchBackup: (token: string) => Promise<BackupEnvelope>
  restore: (envelope: BackupEnvelope, words: string) => Promise<Restored>
  onDone: (restored: Restored) => void
  onCancel: () => void
}

type State = { at: "start" } | { at: "signing-in"; userCode: string | null } | { at: "words"; envelope: BackupEnvelope } | { at: "opening" } | { at: "error"; message: string }

export function Restore({ signIn, fetchBackup, restore, onDone, onCancel }: RestoreProps) {
  const { colors } = useTheme()
  const [state, setState] = useState<State>({ at: "start" })
  const [words, setWords] = useState("")

  const begin = async () => {
    setState({ at: "signing-in", userCode: null })
    try {
      const token = await signIn((step) => setState({ at: "signing-in", userCode: step.step === "waiting" ? step.userCode : null }))
      setState({ at: "words", envelope: await fetchBackup(token) })
    } catch (err) {
      setState({ at: "error", message: err instanceof Error ? err.message : "Sign-in failed." })
    }
  }

  const open = async (envelope: BackupEnvelope) => {
    setState({ at: "opening" })
    try {
      onDone(await restore(envelope, words))
    } catch (err) {
      setWords("")
      setState({ at: "error", message: err instanceof Error ? err.message : "Could not open the backup." })
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.body}>
        <Text variant="display">Sign in</Text>
        {state.at === "start" || state.at === "error" ? (
          <>
            <Text tone="ink2">Sign in to your Kiwi account to bring your channels to this phone. You will need the six words the desktop app showed when you backed up.</Text>
            {state.at === "error" ? (
              <Text accessibilityRole="alert" tone="alert">
                {state.message}
              </Text>
            ) : null}
            <Button title={state.at === "error" ? "Try again" : "Sign in"} onPress={() => void begin()} />
          </>
        ) : null}
        {state.at === "signing-in" ? (
          <>
            <Text tone="ink2">Finish signing in in the browser that opened.</Text>
            {state.userCode ? <Text variant="title">{state.userCode}</Text> : null}
          </>
        ) : null}
        {state.at === "words" ? (
          <>
            <Text tone="ink2">Type the six words. They open your backup on this phone and are never sent anywhere.</Text>
            <TextField label="Six words" value={words} onChangeText={setWords} autoCapitalize="none" autoCorrect={false} autoComplete="off" spellCheck={false} multiline />
            <Button title="Open" disabled={words.trim().length === 0} onPress={() => void open(state.envelope)} />
          </>
        ) : null}
        {state.at === "opening" ? <Text tone="ink2">Opening your backup. This takes a few seconds.</Text> : null}
        {state.at !== "opening" ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 24 },
})
