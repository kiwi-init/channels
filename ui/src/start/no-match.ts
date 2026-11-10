import { useSyncExternalStore } from "react"

import { store } from "~/live/value"

const missed = store<string | null>(null)

export const sawNoMatch = (fingerprint: string): void => missed.set(fingerprint)

export const clearNoMatch = (): void => missed.set(null)

export const useNoMatch = (): string | null => useSyncExternalStore(missed.subscribe, missed.get)
