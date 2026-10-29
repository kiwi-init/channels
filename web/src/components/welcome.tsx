import { hasBridge, relayUrl } from "@kiwi/secrets/relay.ts"
import { CheckListIcon, LockIcon } from "@hugeicons/core-free-icons"
import { useState } from "react"

import { ROBOT_FACES, type RobotFace } from "@kiwi/core/protocol.ts"

import { tokenForCreate, useSignInMode } from "@/lib/auth"
import { bridge, useSecrets } from "@kiwi/secrets/secrets.ts"
import { isSignInGone } from "@kiwi/channel/session.ts"
import { createChannel } from "@kiwi/channel/join.ts"
import { isJoinCode } from "@kiwi/channel/store.ts"
import { linkOf } from "@kiwi/channel/channel-ops.ts"
import { installLine } from "@/lib/join-line"
import { Command } from "./add-agent"
import { RobotPicker } from "./channel-icon"
import { RobotAvatar } from "./robot"
import { Icon } from "./icon"
import { Button, Modal, Monogram, Spinner, TextField, Wordmark, errorText } from "./kit"
import { Stage } from "./join-screens"

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
        <RobotAvatar name="kiwi" size={88} className="-ml-1" label="Channels" />
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
  const [robot, setRobot] = useState<RobotFace>(() => ROBOT_FACES[Math.floor(Math.random() * ROBOT_FACES.length)]!)
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
      await linkOf(m)
        .setIcon({ kind: "robot", robot })
        .catch(() => {
          // The channel exists either way; its owner can still pick the icon from its details.
        })
      setName("")
      setNeedSignIn(false)
      onCreated(m.code)
    } catch (err) {
      const gone = isSignInGone(err)
      setNeedSignIn(gone && !!bridge())
      setError(gone ? (bridge() ? "You need to sign in to create a channel on this relay." : "Creating a channel on this relay needs sign-in, which the Channels desktop app does.") : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} closeLabel="Close New channel">
      <form
        className="p-5"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <h2 className="text-title font-semibold">New channel</h2>
        <p className="mt-1 text-ui leading-normal text-ink-2">You own it and approve everyone who joins. Only members can read its name.</p>
        <div className="mt-4">
          <RobotPicker value={robot} onPick={setRobot} disabled={busy} />
        </div>
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
    <Modal open={open} onClose={onClose} closeLabel="Close Join with a code">
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
