import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { StyleSheet, View } from "react-native"

import { shouldLock, type DeviceAuth } from "../lib/deviceAuth"
import { useTheme } from "../theme/useTheme"
import { Button } from "./Button"
import { Text } from "./Text"

export interface AppLockProps {
  enabled: boolean
  auth: DeviceAuth
  graceMs?: number
  children: ReactNode
}

export function AppLock({ enabled, auth, graceMs, children }: AppLockProps) {
  const { colors } = useTheme()
  const [locked, setLocked] = useState(enabled)
  const [trying, setTrying] = useState(false)
  const leftAt = useRef<number | null>(null)

  const unlock = useCallback(() => {
    auth
      .available()
      .then(async (ok) => {
        if (!ok) return setLocked(false)
        setTrying(true)
        setLocked(!(await auth.authenticate("Open Kiwi")))
      })
      .catch(() => setLocked(true))
      .finally(() => setTrying(false))
  }, [auth])

  const [openedLocked] = useState(enabled)

  useEffect(() => {
    if (openedLocked) unlock()
  }, [openedLocked, unlock])

  useEffect(() => {
    if (!enabled) return
    return auth.subscribe((state) => {
      if (state === "active") {
        if (shouldLock(leftAt.current, auth.now(), graceMs)) {
          setLocked(true)
          unlock()
        }
        leftAt.current = null
      } else if (leftAt.current === null) {
        leftAt.current = auth.now()
      }
    })
  }, [enabled, auth, graceMs, unlock])

  if (!enabled || !locked) return <>{children}</>
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <Text variant="display">Kiwi is locked</Text>
      <Text tone="ink2">Your keys are on this phone. Unlock it to open them.</Text>
      <Button title={trying ? "Unlocking…" : "Unlock"} disabled={trying} onPress={() => unlock()} />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: "center", gap: 16, paddingHorizontal: 24 },
})
