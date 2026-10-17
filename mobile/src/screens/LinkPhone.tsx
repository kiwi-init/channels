import Constants from "expo-constants"
import { useEffect, useRef, useState, type ComponentType } from "react"
import { StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import type { Engine } from "../lib/engine"
import { linkPhone, type LinkStep } from "../lib/linkPhone"
import { setRelayUrl } from "../lib/relay"
import { useTheme } from "../theme/useTheme"
import { Button } from "../ui/Button"
import { QrScanner, type QrScannerProps } from "../ui/QrScanner"
import { Text } from "../ui/Text"
import { TextField } from "../ui/TextField"

export interface LinkPhoneProps {
  engine: Pick<Engine, "adopt">
  onLinked: () => void
  onCancel?: () => void
  Scanner?: ComponentType<QrScannerProps>
  deviceName?: string
  waitMs?: number
}

export function digitsLine(digits: string): string {
  return digits.length === 6 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits
}

export function LinkPhone({ engine, onLinked, onCancel, Scanner = QrScanner, deviceName = Constants.deviceName ?? "Phone", waitMs }: LinkPhoneProps) {
  const { colors } = useTheme()
  const [text, setText] = useState("")
  const [scanning, setScanning] = useState(false)
  const [step, setStep] = useState<LinkStep | null>(null)
  const stop = useRef<AbortController | null>(null)

  useEffect(() => () => stop.current?.abort(), [])

  const start = (code: string) => {
    stop.current?.abort()
    const controller = new AbortController()
    stop.current = controller
    setScanning(false)
    void linkPhone(code, { adopt: (p, c) => engine.adopt(p, c), setRelay: setRelayUrl, deviceName, waitMs }, setStep, controller.signal)
  }

  const reset = () => {
    stop.current?.abort()
    setStep(null)
    setText("")
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={styles.body}>
        <Text variant="display">Link this phone</Text>
        {step === null || step.kind === "error" ? (
          <>
            <Text tone="ink2">On your desktop, open Your computers in Kiwi and choose Link a phone. Scan the code it shows, or paste it here.</Text>
            {scanning ? (
              <Scanner onCode={start} onClose={() => setScanning(false)} />
            ) : (
              <>
                <Button title="Scan the code" onPress={() => setScanning(true)} />
                <TextField
                  label="Link code"
                  value={text}
                  onChangeText={setText}
                  placeholder="kl1-…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="go"
                  onSubmitEditing={() => text.trim() && start(text)}
                />
                <Button title="Link" variant="secondary" disabled={!text.trim()} onPress={() => start(text)} />
              </>
            )}
            {step?.kind === "error" ? (
              <View accessibilityRole="alert" style={[styles.error, { backgroundColor: colors.wash }]}>
                <Text variant="ui" tone="alert">
                  {step.message}
                </Text>
              </View>
            ) : null}
            {step?.kind === "error" ? <Button title="Try again" variant="secondary" onPress={reset} /> : null}
            {onCancel && step === null ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
          </>
        ) : null}
        {step?.kind === "asking" ? <Text tone="ink2">Contacting your desktop…</Text> : null}
        {step?.kind === "waiting" ? (
          <>
            <Text tone="ink2">Check that your desktop shows the same six numbers. Only if they match, press It matches: link there.</Text>
            <Text accessibilityLabel={`Check numbers ${step.digits.split("").join(" ")}`} variant="display" numbers style={styles.digits}>
              {digitsLine(step.digits)}
            </Text>
            <Button title="Cancel" variant="secondary" onPress={reset} />
          </>
        ) : null}
        {step?.kind === "saving" ? <Text tone="ink2">Saving your keys to this phone…</Text> : null}
        {step?.kind === "done" ? (
          <>
            <Text tone="ink2">{`Linked as ${step.name}. ${step.channels === 1 ? "One channel" : `${step.channels} channels`} came with it.`}</Text>
            <Button title="Open Kiwi" onPress={onLinked} />
          </>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  digits: { fontSize: 44, lineHeight: 48, letterSpacing: 1 },
  error: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
})
