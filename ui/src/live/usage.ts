import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import type { Actions, Usage } from "~/model"

export const myUsage: Actions["myUsage"] = async () => {
  try {
    const token = await bridge()?.getToken()
    if (!token) return null
    const res = await fetch(`${relayUrl()}/v1/me/usage`, { headers: { "x-human-token": token } })
    return res.ok ? ((await res.json()) as Usage) : null
  } catch {
    // An older relay, or no reach to it: Account shows no usage row.
    return null
  }
}
