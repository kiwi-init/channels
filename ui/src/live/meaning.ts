import { relayUrl } from "@kiwi/secrets/relay.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"

export type MeaningItem = { id: number; from: string; where: string; text: string }
export type MeaningHit = { id: number; p: number }

let on: Promise<boolean> | null = null

export function meaningOn(): Promise<boolean> {
  on ??= fetch(`${relayUrl()}/v1/meaning`).then(
    (res) => res.ok,
    () => false
  )
  const asked = on
  void asked.then((yes) => {
    if (!yes && on === asked) on = null
  })
  return asked
}

async function token(): Promise<string | null> {
  const b = bridge()
  const mine = (await b?.getToken()) ?? null
  if (mine || import.meta.env.VITE_KIWI_DEMO !== "1" || !b) return mine
  return (await b.devSignIn("demo").catch(() => null))?.token ?? null
}

export async function searchMeaning(query: string, items: MeaningItem[]): Promise<MeaningHit[] | null> {
  try {
    const signed = await token()
    if (!signed) return null
    const res = await fetch(`${relayUrl()}/v1/meaning`, {
      method: "POST",
      headers: { "x-human-token": signed, "content-type": "application/json" },
      body: JSON.stringify({ query, items }),
    })
    return res.ok ? ((await res.json()) as { hits: MeaningHit[] }).hits : null
  } catch {
    // No reach to the relay: the row says Jev couldn't be reached.
    return null
  }
}
