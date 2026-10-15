import { hasBridge, relayUrl } from "../lib/relay"
import { CheckListIcon, LockIcon } from "@hugeicons/core-free-icons"
import { useEffect, useState, type ReactNode } from "react"

import { handleFor, NAME_RE } from "@mc/membership.ts"
import { tokenForCreate, useSignInMode } from "@/lib/auth"
import { isJoinBlip } from "@/lib/join-blip"
import { bridge, useSecrets } from "@/lib/secrets"
import { isSignInGone } from "@/lib/session"
import { askToJoin, checkJoin, createChannel, forgetPending, inviteInfo, isJoinCode, loadMember, loadPending, type ChannelRow, type PendingJoin, type StoredMember } from "@/lib/channel"
import { Conversation } from "./conversation"
import { installLine } from "@/lib/join-line"
import { Command } from "./add-agent"
import { CoordinatorHead } from "./coordinator-head"
import { Icon } from "./icon"
import { Button, Modal, Monogram, Spinner, TextField, Wordmark, errorText } from "./kit"

/** Every screen that isn't a conversation: one calm, left-aligned column. */
function Stage({ children, width = 380 }: { children: ReactNode; width?: number }) {
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

// ---------- nothing selected ----------

/** What a channel looks like, shown instead of described. */
function Specimen() {
  const row = (name: string, agent: boolean, said: string | null, body: string) => (
    <div className="grid grid-cols-[24px_1fr] gap-x-3">
      <Monogram name={name} agent={agent} size={24} />
      <div>
        <p className="text-ui">
          <span className="font-semibold">{name}</span>
          {said && <span className="text-ink-2"> {said}</span>}
        </p>
        <p className="text-ui leading-[1.55]">{body}</p>
      </div>
    </div>
  )
  return (
    <div aria-hidden className="grid gap-3.5 rounded-card bg-rail p-5 select-none">
      {row("claude", true, null, "Taking the reconnect backoff in src/relay; I’ll say when it’s up.")}
      <div className="grid grid-cols-[24px_1fr] gap-x-3 text-ui text-ink-2">
        <span className="flex justify-center pt-[2px] text-ink-3">
          <Icon icon={CheckListIcon} size={13} />
        </span>
        <p>
          <span className="font-medium text-ink">grok</span> finished T4 “Retry with jitter”
        </p>
      </div>
      {row("win", true, "asked claude", "Does the backoff cap at 30 seconds?")}
      {row("Jonatas Filho", false, null, "Ship it once win signs off.")}
    </div>
  )
}

export function Welcome({ onNew, onJoin }: { onNew: () => void; onJoin: () => void }) {
  const person = useSecrets().person
  // With channels or a person key, this is a workspace with nothing open, not a pitch: say what to do next.
  if (person)
    return (
      <Stage width={460}>
        <CoordinatorHead size={88} live loop interactive seed={0.6} className="-ml-1" label="Kiwi" />
        <h1 className="mt-4 text-display font-semibold">Nothing open</h1>
        <p className="mt-1.5 text-body text-ink-2">
          {/* In the app, this computer's kiwi is the app's to keep (desktop/src/cli.ts). */}
          {hasBridge()
            ? "Pick a channel on the left, or start one. Agents on this computer already have kiwi: the app installs it and keeps it current. For another computer, add it from Your computers, or paste this into the terminal its agents work in."
            : "Pick a channel on the left, or start one. Your agents need kiwi on their computer: add it from Your computers, or paste this into the terminal they work in."}
        </p>
        <Command text={installLine(relayUrl())} label="Copy the install command" />
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onNew}>
            New channel
          </Button>
          <Button variant="ghost" onClick={onJoin}>
            Join with a code
          </Button>
        </div>
      </Stage>
    )
  return (
    <Stage width={500}>
      <Wordmark className="text-[40px] leading-none" />
      <p className="mt-4 text-title leading-[1.5] text-ink-2">
        Private channels where your agents work together in real time. You approve everyone who joins, watch the work, and step in when it matters.
      </p>
      <div className="mt-7 flex flex-wrap gap-2">
        <Button size="lg" onClick={onNew}>
          New channel
        </Button>
        <Button size="lg" variant="secondary" onClick={onJoin}>
          Join with a code
        </Button>
      </div>
      <div className="mt-12">
        <Specimen />
      </div>
      <p className="mt-5 flex items-center gap-1.5 text-meta text-ink-3">
        <Icon icon={LockIcon} size={12} />
        End-to-end encrypted. Close a channel and nothing is left on the relay.
      </p>
    </Stage>
  )
}

export function NewChannel({
  open,
  onClose,
  onCreated,
  onJoin,
}: {
  open: boolean
  onClose: () => void
  onCreated: (code: string) => void
  /** Have a code instead: join with it. */ onJoin?: () => void
}) {
  const person = useSecrets().person
  const signIn = useSignInMode()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needSignIn, setNeedSignIn] = useState(false)

  const create = async (fresh = false) => {
    setBusy(true)
    setError(null)
    try {
      // The one place sign-in is asked for: a relay with sign-in lets signed-in people create channels.
      const token = await tokenForCreate(fresh)
      const m = await createChannel(name.trim() || "Untitled channel", token, person ? { name: person.name } : null)
      setName("")
      setNeedSignIn(false)
      onCreated(m.code)
    } catch (err) {
      const gone = isSignInGone(err)
      setNeedSignIn(gone && !!bridge())
      setError(gone ? (bridge() ? "You need to sign in to create a channel on this relay." : "Creating a channel on this relay needs sign-in, which the Kiwi desktop app does.") : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <h2 className="text-title font-semibold">New channel</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">You own it and approve everyone who joins. Only members can read its name.</p>
        <TextField className="mt-4" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="payments-refactor" maxLength={60} autoComplete="off" />
        {signIn === "workos" && <p className="mt-3 text-meta leading-normal text-ink-3">This relay asks you to sign in to create a channel. Your browser opens for it.</p>}
        {error && <p className="mt-3 rounded-ctl bg-wash px-3 py-2.5 text-ui leading-normal text-alert">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          {onJoin && (
            <button type="button" onClick={onJoin} className="mr-auto text-ui font-medium text-accent-text hover:underline">
              Have a code? Join
            </button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {needSignIn ? (
            <Button disabled={busy} onClick={() => void create(true)}>
              {busy ? <Spinner className="border-white/30 border-t-white" /> : "Sign in"}
            </Button>
          ) : (
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner className="border-white/30 border-t-white" /> : "Create channel"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}

export function JoinWithCode({ open, onClose, onJoin }: { open: boolean; onClose: () => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState("")
  const valid = isJoinCode(code.trim())
  return (
    <Modal open={open} onClose={onClose}>
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onJoin(code.trim())
          setCode("")
        }}
      >
        <h2 className="text-title font-semibold">Join with a code</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">A code only lets you ask. The owner lets you in after checking a short number with you.</p>
        <TextField className="mt-4 font-mono text-ui" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="mc2-…" autoComplete="off" spellCheck={false} />
        {code.trim() && !valid && <p className="mt-2 text-ui text-ink-2">Join codes start with mc2- and have two more parts.</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid}>
            Continue
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- a channel: member, waiting, or asking ----------

type Phase =
  | { kind: "loading" }
  | { kind: "ask" }
  | { kind: "waiting"; pending: PendingJoin; code: string | null }
  | { kind: "denied" }
  | { kind: "member"; member: StoredMember }
  | { kind: "error"; message: string }

/** Decide what this browser is in a channel: a member, waiting for approval, or a visitor who may ask. */
export function ChannelGate({ code, listed, onBack, onGone }: { code: string; listed?: ChannelRow; onBack: () => void; onGone: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!isJoinCode(code)) return setPhase({ kind: "error", message: "That isn’t a join code. Join codes start with mc2-." })
      try {
        const stored = loadMember(code)
        if (stored) return setPhase({ kind: "member", member: stored })
        const pending = loadPending(code)
        setPhase(pending ? { kind: "waiting", pending, code: null } : { kind: "ask" })
      } catch (err) {
        if (!cancelled) setPhase({ kind: "error", message: errorText(err) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

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
  }, [phase])

  if (phase.kind === "member") return <Conversation member={phase.member} onBack={onBack} onGone={onGone} />

  // Cancelling or being declined drops only the request; nothing this browser holds is touched.
  const giveUp = () => {
    forgetPending(code)
    onGone()
  }

  return (
    <Stage>
      {phase.kind === "loading" && <Spinner />}
      {phase.kind === "ask" && <AskToJoin code={code} listed={listed} onAsked={(pending) => setPhase({ kind: "waiting", pending, code: null })} onCancel={onGone} />}
      {phase.kind === "waiting" && (
        <>
          <Heading title="Waiting for the owner">
            {phase.code ? (
              <>
                They see your request as <span className="font-medium text-ink">{phase.pending.identity.name}</span>, next to this number. If they ask, make sure it matches.
              </>
            ) : (
              <>
                Your request is in as <span className="font-medium text-ink">{phase.pending.identity.name}</span>. When the owner opens it, a 6-digit code shows here and next to your request. They let
                you in once the two match.
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
  )
}

function AskToJoin({ code, listed, onAsked, onCancel }: { code: string; listed?: ChannelRow; onAsked: (p: PendingJoin) => void; onCancel: () => void }) {
  const person = useSecrets().person
  // People join under their own name, from their person key.
  const suggested = person ? handleFor(person.name) : ""
  const [name, setName] = useState(suggested)
  const [role, setRole] = useState("")
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
    listed?.state === "agents"
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
          onAsked(await askToJoin(code, name.trim(), role.trim() || undefined))
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
      <label className="mt-4 block text-meta font-medium text-ink-2" htmlFor="ask-role">
        Role <span className="font-normal text-ink-3">(optional)</span>
      </label>
      <TextField id="ask-role" className="mt-1.5" value={role} onChange={(e) => setRole(e.target.value)} placeholder="reviewer" />
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
