import { askToLink, dropLink, linkDigits, newLinkKeys, openLink, readLinkCode, waitForLinkChunks, type LinkChannel } from "@mc/link.ts"
import { MailboxError } from "@mc/mailbox.ts"

import type { ChannelIdentityView, PersonView } from "../../../desktop/src/bridge.ts"

export type LinkStep =
  | { kind: "asking" }
  | { kind: "waiting"; digits: string; relay: string }
  | { kind: "saving" }
  | { kind: "done"; name: string; channels: number }
  | { kind: "error"; message: string }

export interface LinkDeps {
  adopt: (person: PersonView, channels: ChannelIdentityView[]) => Promise<void>
  setRelay: (url: string) => boolean
  deviceName: string
  waitMs?: number
  fetchImpl?: typeof fetch
}

export const NOT_A_LINK_CODE = "That isn’t a link code. Link codes start with kl1-."
export const CODE_USED = "That code was already used. Make a new one on your desktop."
export const NO_ANSWER = "Your desktop didn’t answer in time. Make a new code and try again."
export const DID_NOT_OPEN = "What came back didn’t open. It was not made for this phone, or was changed on the way. Make a new code."
export const DEFAULT_WAIT_MS = 9 * 60_000

export function toChannelIdentity(c: LinkChannel): ChannelIdentityView {
  const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
  return {
    label: c.label,
    pk: c.pk,
    sk: c.sk,
    ...(text(c.xpk) ? { xpk: text(c.xpk) } : {}),
    ...(text(c.xsk) ? { xsk: text(c.xsk) } : {}),
    ...(text(c.roomId) ? { roomId: text(c.roomId) } : {}),
    ...(text(c.code) ? { code: text(c.code) } : {}),
    ...(text(c.idName) ? { idName: text(c.idName) } : {}),
    ...(text(c.name) ? { name: text(c.name) } : {}),
    ...(text(c.requestId) ? { requestId: text(c.requestId) } : {}),
    ...(typeof c.at === "number" ? { at: c.at } : {}),
    ...(c.imported === true ? { imported: true } : {}),
    ...(c.access !== undefined ? { access: c.access } : {}),
  }
}

function failure(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function linkPhone(text: string, deps: LinkDeps, on: (step: LinkStep) => void, signal: AbortSignal): Promise<void> {
  const code = readLinkCode(text)
  if (!code) return on({ kind: "error", message: NOT_A_LINK_CODE })
  const fetchImpl = deps.fetchImpl ?? fetch
  try {
    on({ kind: "asking" })
    const keys = await newLinkKeys()
    const digits = await linkDigits(code.secret, code.dxpk, keys.xpk)
    try {
      await askToLink(code.relay, code, keys.xpk, deps.deviceName, fetchImpl)
    } catch (err) {
      return on({ kind: "error", message: err instanceof MailboxError && err.status === 409 ? CODE_USED : failure(err) })
    }
    on({ kind: "waiting", digits, relay: code.relay })
    const chunks = await waitForLinkChunks(code.relay, code.secret, { timeoutMs: deps.waitMs ?? DEFAULT_WAIT_MS, everyMs: 1_500, signal }, fetchImpl)
    if (signal.aborted) return
    if (!chunks) return on({ kind: "error", message: NO_ANSWER })
    const payload = await openLink(code, keys.xsk, keys.xpk, chunks)
    if (!payload) return on({ kind: "error", message: DID_NOT_OPEN })
    on({ kind: "saving" })
    deps.setRelay(payload.relayUrl)
    await deps.adopt({ name: payload.person.name, pk: payload.person.pk, sk: payload.person.sk, xpk: payload.person.xpk, xsk: payload.person.xsk }, payload.channels.map(toChannelIdentity))
    await dropLink(code.relay, code.secret, chunks.length, fetchImpl).catch(() => {})
    on({ kind: "done", name: payload.person.name, channels: payload.channels.length })
  } catch (err) {
    if (!signal.aborted) on({ kind: "error", message: failure(err) })
  }
}
