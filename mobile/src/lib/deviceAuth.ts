import * as LocalAuthentication from "expo-local-authentication"
import { AppState, type AppStateStatus } from "react-native"

export interface DeviceAuth {
  available: () => Promise<boolean>
  authenticate: (reason: string) => Promise<boolean>
  subscribe: (listener: (state: AppStateStatus) => void) => () => void
  now: () => number
}

export const deviceAuth: DeviceAuth = {
  available: async () => (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()),
  authenticate: async (reason) => (await LocalAuthentication.authenticateAsync({ promptMessage: reason })).success,
  subscribe: (listener) => {
    const sub = AppState.addEventListener("change", listener)
    return () => sub.remove()
  },
  now: () => Date.now(),
}

export const LOCK_GRACE_MS = 30_000

export function shouldLock(leftAt: number | null, now: number, graceMs = LOCK_GRACE_MS): boolean {
  return leftAt !== null && now - leftAt > graceMs
}
