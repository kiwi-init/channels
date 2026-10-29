import { useEffect, useState, type ReactNode } from "react"

import { handleFor, NAME_RE } from "@kiwi/core/membership.ts"
import { isJoinBlip } from "@/lib/join-blip"
import { useSecrets } from "@kiwi/secrets/secrets.ts"
import { askToJoin, checkJoin, inviteInfo } from "@kiwi/channel/join.ts"
import { forgetPending, type PendingJoin } from "@kiwi/channel/store.ts"
import { type ChannelRow } from "@kiwi/channel/list.ts"
import { Button, Spinner, TextField, errorText } from "./kit"
import type { Phase } from "./onboarding"

/** Every screen that isn't a conversation: one calm, left-aligned column. */
export function Stage({ children, width = 380 }: { children: ReactNode; width?: number }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  )
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <h2 className="text-display leading-tight font-semibold tracking-[-0.02em]">{title}</h2>
      {children && <p className="mt-2 text-body leading-normal text-ink-2">{children}</p>}
    </>
  )
}

function VerifyCode({ code }: { code: string }) {
  return <div className="my-6 text-[44px] leading-none font-semibold tracking-[0.04em] tabular-nums">{code}</div>
}

export function JoinScreens({
  code,
  phase,
  setPhase,
  listedState,
  onBack,
  onGone,
}: {
  code: string
  phase: Exclude<Phase, { kind: "member" }>
  setPhase: (next: Phase) => void
  listedState?: ChannelRow["state"]
  onBack: () => void
  onGone: () => void
}) {
  const [unreachable, setUnreachable] = useState(false)

  // Poll a pending request until the owner decides. A blip stays on waiting.
  useEffect(() => {
    if (phase.kind !== "waiting") return
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        const r = await checkJoin(phase.pending)
        if (stop) return
        setUnreachable(false)
        if (r === "denied") return setPhase({ kind: "denied" })
        if ("access" in r) return setPhase({ kind: "member", member: r })
        if (r.code !== phase.code) return setPhase({ ...phase, code: r.code })
      } catch (err) {
        if (stop) return
        if (!isJoinBlip(err)) return setPhase({ kind: "error", message: errorText(err) })
        setUnreachable(true)
      }
      setTimeout(tick, 2000)
    }
    void tick()
    return () => {
      stop = true
    }
  }, [phase, setPhase])

  // Cancelling or being declined drops only the request; nothing this browser holds is touched.
  const giveUp = () => {
    forgetPending(code)
    onGone()
  }

  return (
    <div className="flex min-w-0 flex-1 md:sheet">
      <Stage>
        {phase.kind === "ask" && <AskToJoin code={code} listedState={listedState} onAsked={(pending) => setPhase({ kind: "waiting", pending, code: null })} onCancel={onGone} />}
        {phase.kind === "waiting" && (
          <>
            <Heading title="Waiting for the owner">
              {phase.code ? (
                <>
                  They see your request as <span className="font-medium text-ink">{phase.pending.identity.name}</span>, next to this number. If they ask, make sure it matches.
                </>
              ) : (
                <>
                  Your request is in as <span className="font-medium text-ink">{phase.pending.identity.name}</span>. When the owner opens it, a 6-digit code shows here and next to your request. They
                  let you in once the two match.
                </>
              )}
            </Heading>
            {phase.code && <VerifyCode code={phase.code} />}
            <div className="flex items-center gap-3">
              <Spinner />
              <span className="text-ui text-ink-2">{unreachable ? "Can’t reach the relay. Still waiting." : "This page updates the moment you’re in."}</span>
            </div>
            <Button variant="ghost" className="mt-6 -ml-3.5" onClick={giveUp}>
              Cancel request
            </Button>
          </>
        )}
        {(phase.kind === "denied" || phase.kind === "error") && (
          <>
            <Heading title={phase.kind === "denied" ? "The owner didn’t let you in" : "This channel won’t open"}>
              {phase.kind === "denied" ? "Your request was declined. Ask the owner for a new code if that was a mistake." : phase.message}
            </Heading>
            <Button variant="secondary" className="mt-6" onClick={phase.kind === "denied" ? giveUp : onBack}>
              Back to channels
            </Button>
          </>
        )}
      </Stage>
    </div>
  )
}

function AskToJoin({ code, listedState, onAsked, onCancel }: { code: string; listedState?: ChannelRow["state"]; onAsked: (p: PendingJoin) => void; onCancel: () => void }) {
  const person = useSecrets().person
  // People join under their own name, from their person key.
  const suggested = person ? handleFor(person.name) : ""
  const [name, setName] = useState(suggested)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = NAME_RE.test(name.trim()) && name.trim() !== "human"
  // Who sent this invite, as the relay knows them; "gone" when the channel was closed.
  const [invite, setInvite] = useState<{ ownerName: string | null } | "gone" | "loading">("loading")
  useEffect(() => {
    let cancelled = false
    inviteInfo(code)
      .then((i) => !cancelled && setInvite(i ?? "gone"))
      .catch(() => !cancelled && setInvite({ ownerName: null }))
    return () => {
      cancelled = true
    }
  }, [code])

  if (invite === "loading") return <Spinner />
  if (invite === "gone") {
    return (
      <>
        <Heading title="This invite no longer works">The channel was closed, or the code is wrong. Ask whoever sent it for a new one.</Heading>
        <Button variant="secondary" className="mt-6" onClick={onCancel}>
          Back
        </Button>
      </>
    )
  }

  const owner = invite.ownerName
  const intro =
    listedState === "agents"
      ? { title: "Your agents are in this channel", text: "Ask the owner to let you in as well, so you can watch what they do." }
      : { title: owner ? `${owner} invited you to a channel` : "You’re invited to a channel", text: null }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        setBusy(true)
        setError(null)
        try {
          onAsked(await askToJoin(code, name.trim()))
        } catch (err) {
          setError(errorText(err))
        } finally {
          setBusy(false)
        }
      }}
    >
      <Heading title={intro.title}>{intro.text ?? `A code only lets you ask. ${owner ?? "The owner"} approves every member, person or agent.`}</Heading>
      <label className="mt-6 block text-meta font-medium text-ink-2" htmlFor="ask-name">
        Your name in the channel
      </label>
      <TextField id="ask-name" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-invalid={!!name && !valid} />
      {error && <p className="mt-3 text-ui text-alert">{error}</p>}
      <div className="mt-6 flex gap-2">
        <Button size="lg" type="submit" disabled={!valid || busy}>
          {busy ? <Spinner className="border-white/30 border-t-white" /> : "Ask to join"}
        </Button>
        <Button size="lg" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="mt-6 text-meta leading-normal text-ink-3">Your key is made in this browser. Once you’re in, messages are decrypted here and nowhere else.</p>
    </form>
  )
}
