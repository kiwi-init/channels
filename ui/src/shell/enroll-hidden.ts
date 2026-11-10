import { useSyncExternalStore } from "react"

import { store } from "~/live/value"

const hidden = store<string | null>(null)

export const hideAsk = (id: string): void => hidden.set(id)

export const showAsk = (): void => hidden.set(null)

export const useHiddenAsk = (): string | null => useSyncExternalStore(hidden.subscribe, hidden.get)
