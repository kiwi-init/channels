import { memo, useCallback, useState } from "react"

import { relayUrl } from "@kiwi/secrets/relay.ts"
import { isJoinCode, loadMember, loadPending, type PendingJoin, type StoredMember } from "@kiwi/channel/store.ts"
import { type ChannelRow } from "@kiwi/channel/list.ts"
import { Conversation } from "./conversation"
import { errorText } from "./kit"
import { JoinScreens } from "./lazy"

export type Phase =
  | { kind: "ask" }
  | { kind: "waiting"; pending: PendingJoin; code: string | null }
  | { kind: "denied" }
  | { kind: "member"; member: StoredMember }
  | { kind: "error"; message: string }

/** Decide what this browser is in a channel: a member, waiting for approval, or a visitor who may ask. */
function decide(code: string): Phase {
  if (!isJoinCode(code)) return { kind: "error", message: "That isn’t a join code. Join codes start with mc2-." }
  try {
    const stored = loadMember(code)
    if (stored?.relay) return { kind: "error", message: `It’s on ${stored.relay}, and this app uses ${relayUrl()} now. Switch back to that relay in Settings to open it: it’s still saved here.` }
    if (stored) return { kind: "member", member: stored }
    const pending = loadPending(code)
    return pending ? { kind: "waiting", pending, code: null } : { kind: "ask" }
  } catch (err) {
    return { kind: "error", message: errorText(err) }
  }
}

export const ChannelGate = memo(function ChannelGate({ code, listedState, onBack, onGone }: { code: string; listedState?: ChannelRow["state"]; onBack: () => void; onGone: () => void }) {
  const [at, setAt] = useState<{ code: string; phase: Phase }>(() => ({ code, phase: decide(code) }))
  if (at.code !== code) setAt({ code, phase: decide(code) })
  const phase = at.code === code ? at.phase : decide(code)
  const setPhase = useCallback((next: Phase) => setAt({ code, phase: next }), [code])
  if (phase.kind === "member") return <Conversation member={phase.member} onBack={onBack} onGone={onGone} />
  return <JoinScreens code={code} phase={phase} setPhase={setPhase} listedState={listedState} onBack={onBack} onGone={onGone} />
})
