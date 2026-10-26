import { useEffect, useState } from "react"

import { bridge, type KeysAtRest } from "./secrets"

export const KEYS_UNSEALED = "No keyring is running here, so your keys are kept unencrypted, in a file only you can read. Start GNOME Keyring or KDE Wallet, and Channels seals them on its next start."

export function useUnsealedKeys(): KeysAtRest | null {
  const [keys, setKeys] = useState<KeysAtRest | null>(null)
  useEffect(() => {
    const b = bridge()
    if (!b?.keysAtRest) return
    void b
      .keysAtRest()
      .then((k) => setKeys(k.sealed ? null : k))
      .catch(() => {})
  }, [])
  return keys
}
