import { useEffect, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { joinCodeFromInput } from "../lib/deep-link"
import type { Engine } from "../lib/engine"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"
import { toast } from "../ui/Toast"

const POLL_MS = 2000

export interface JoinProps {
  engine: Engine
  initialCode?: string
  onJoined: (code: string) => void
  onDenied?: () => void
}

type Stage = { kind: "ask" } | { kind: "waiting"; code: string; digits: string | null } | { kind: "denied" }

export function Join({ engine, initialCode, onJoined, onDenied }: JoinProps) {
  const { colors } = useTheme()
  const [text, setText] = useState(initialCode ?? "")
  const [stage, setStage] = useState<Stage>({ kind: "ask" })
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const code = joinCodeFromInput(text)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const poll = (joinCode: string) => {
    timer.current = setTimeout(async () => {
      try {
        const status = await engine.checkJoin(joinCode)
        if (status.status === "in") return onJoined(joinCode)
        if (status.status === "denied") {
          setStage({ kind: "denied" })
          return onDenied?.()
        }
        setStage({ kind: "waiting", code: joinCode, digits: status.code ?? null })
      } catch {
        return poll(joinCode)
      }
      poll(joinCode)
    }, POLL_MS)
  }

  const ask = async () => {
    if (!code) return
    setBusy(true)
    try {
      await engine.requestJoin(code)
      setStage({ kind: "waiting", code, digits: null })
      poll(code)
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not ask to join", "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.body}>
        <Text variant="display">Join a channel</Text>
        {stage.kind === "ask" ? (
          <>
            <Text tone="ink2">Paste the invite link or code you were given.</Text>
            <TextField label="Invite link or code" value={text} onChangeText={setText} autoCapitalize="none" autoCorrect={false} />
            <Button title="Ask to join" disabled={!code || busy} onPress={() => void ask()} />
          </>
        ) : stage.kind === "waiting" ? (
          <>
            <Text tone="ink2">Waiting for the channel's owner to let you in.</Text>
            {stage.digits ? (
              <>
                <Text tone="ink2">Read these digits to the owner so they know it is you:</Text>
                <Text variant="display" numbers accessibilityLabel={`Your code is ${stage.digits}`}>
                  {stage.digits}
                </Text>
              </>
            ) : (
              <Text tone="ink3">Getting your code…</Text>
            )}
          </>
        ) : (
          <Text tone="alert">The owner turned this request down.</Text>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 24 },
})
