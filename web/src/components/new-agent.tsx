import { Dialog } from "@base-ui/react/dialog"
import { CheckmarkCircle02Icon, Folder01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState, type ReactNode } from "react"

import type { HarnessRow, KnownHarness } from "@kiwi/core/harnesses.ts"
import { personaOf, type Persona, type Personality } from "@kiwi/core/personality.ts"
import type { FromMachine, LaunchedView, MachineView } from "../../../desktop/src/bridge.ts"
import { harnessName } from "@/lib/harness"
import { followLaunch, launcher, sawMembers, type LaunchSeen } from "@/lib/launches"
import { usePersonalities } from "@/lib/personalities"
import { relayUrl } from "@/lib/relay"
import { showInRex } from "@/lib/rex"
import { cx } from "@/lib/utils"
import { HarnessFace } from "./harness-face"
import { Icon } from "./icon"
import { Button, Modal, Spinner, TextField } from "./kit"
import { PersonalityPicker } from "./personality-picker"

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u

function launchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const PLACE: Record<"rex" | "tmux" | "terminal", string> = { rex: "Rex", tmux: "tmux", terminal: "Terminal" }

type Started = Extract<LaunchedView, { ok: true }>

interface Props {
  open: boolean
  onClose: () => void
  code: string
  roomId: string
  channel: string
  lead?: string | null
  onPin?: (p: Personality) => Promise<string>
  roster: readonly { pk: string; name: string; active?: boolean }[]
}

export function NewAgent(props: Props) {
  return (
    <Modal open={props.open} onClose={props.onClose} wide>
      {props.open && <NewAgentBody {...props} />}
    </Modal>
  )
}

function NewAgentBody({ onClose, code, roomId, channel, lead, onPin, roster }: Props) {
  const all = usePersonalities()
  const [machines, setMachines] = useState<MachineView[]>([])
  const [machine, setMachine] = useState<string | null>(null)
  const [unreachable, setUnreachable] = useState<string | null>(null)
  const [rows, setRows] = useState<HarnessRow[] | null>(null)
  const [harness, setHarness] = useState<KnownHarness | null>(null)
  const [folders, setFolders] = useState<string[]>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [nick, setNick] = useState("")
  const [persona, setPersona] = useState<Persona | null>(() => (all[0] ? personaOf(all[0]) : null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<Started | null>(null)
  const [seen, setSeen] = useState<LaunchSeen | null>(null)
  const stop = useRef<(() => void) | null>(null)

  useEffect(() => {
    let live = true
    void launcher()
      ?.machines?.()
      .then(
        (list) => live && setMachines(list),
        () => {}
      )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const b = launcher()
    if (!b) return
    let live = true
    const take = <T,>(got: FromMachine<T>, apply: (v: T) => void) => {
      if (!live) return
      if (got.ok) apply(got.value)
      else setUnreachable(got.detail)
    }
    const local = <T,>(p: Promise<T>): Promise<FromMachine<T>> => p.then((value) => ({ ok: true as const, value }))
    const harnesses = machine && b.harnessesOn ? b.harnessesOn(machine) : local(b.harnesses())
    const folders = machine && b.foldersOn ? b.foldersOn(machine, roomId) : local(b.seatFolders(roomId))
    void harnesses.then(
      (got) =>
        take(got, (list) => {
          setRows(list)
          setHarness((h) => h ?? list.find((r) => r.path && r.start)?.harness ?? null)
        }),
      () => live && setRows([])
    )
    void folders.then(
      (got) =>
        take(got, (list) => {
          setFolders(list)
          setFolder((f) => f ?? list[0] ?? null)
        }),
      () => {}
    )
    return () => {
      live = false
    }
  }, [roomId, machine])

  const pickMachine = (pk: string | null) => {
    if (pk === machine) return
    setMachine(pk)
    setRows(null)
    setHarness(null)
    setFolders([])
    setFolder(null)
    setUnreachable(null)
    setError(null)
  }
  const remote = machine ? machines.find((m) => m.machinePk === machine) : undefined
  const here = machines.find((m) => m.own)
  const others = machines.filter((m) => !m.own)

  useEffect(() => () => stop.current?.(), [])
  useEffect(() => sawMembers(code, roster), [code, roster])

  const choose = async () => {
    const picked = await launcher()?.chooseFolder()
    if (!picked) return
    setFolders((list) => (list.includes(picked) ? list : [picked, ...list]))
    setFolder(picked)
  }

  const name = nick.trim()
  const bad = name && !NICK.test(name) ? "A nickname is up to 40 letters, digits, spaces, _ . or -, starting with a letter or digit." : null

  const start = async () => {
    const b = launcher()
    if (!b || !harness || !folder || bad) return
    setBusy(true)
    setError(null)
    const launch = launchId()
    stop.current?.()
    stop.current = followLaunch(code, launch, (s) => setSeen((was) => (was?.stage === "joined" ? was : s)))
    try {
      const chosen = persona ? all.find((p) => p.name === persona.name) : undefined
      const pin = chosen && onPin ? await onPin(chosen) : undefined
      const r = await b.launchAgent({ ...(machine ? { machinePk: machine } : {}), launch, harness, folder, code, relay: relayUrl(), ...(name ? { nick: name } : {}), ...(pin ? { persona: pin } : {}) })
      if (r.ok) setStarted(r)
      else {
        stop.current?.()
        stop.current = null
        setError(r.detail || "Kiwi couldn’t start it.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (started) return <Progress started={started} seen={seen} harness={harness} on={remote?.label} onClose={onClose} />

  return (
    <form
      className="p-5"
      onSubmit={(e) => {
        e.preventDefault()
        void start()
      }}
    >
      <Dialog.Title className="text-title font-semibold">New agent</Dialog.Title>
      <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">It starts in a terminal on this computer and joins {channel} by itself.</Dialog.Description>

      {others.length > 0 && (
        <Field label="Computer">
          <div role="radiogroup" aria-label="Computer" className="grid grid-cols-2 gap-1.5">
            <Option on={machine === null} onPick={() => pickMachine(null)} disabled={busy}>
              <MachineLine label={here?.label ?? "This computer"} detail="This computer" online={here ? here.online : true} />
            </Option>
            {others.map((m) => (
              <Option key={m.machinePk} on={machine === m.machinePk} onPick={() => pickMachine(m.machinePk)} disabled={busy} off={m.online === false}>
                <MachineLine label={m.label} detail={m.online === false ? "Offline" : m.os} online={m.online} />
              </Option>
            ))}
          </div>
          {remote && (
            <p className="mt-2 text-meta leading-normal text-ink-3">Kiwi asks {remote.label} through the relay, signed by you; it starts the agent there and answers once its window is open.</p>
          )}
        </Field>
      )}

      {unreachable && <p className="mt-4 rounded-ctl bg-wash px-3 py-2.5 text-ui leading-normal text-ink-2">{unreachable}</p>}

      <Field label="Harness">
        {rows === null ? (
          <p className="flex h-10 items-center gap-2 text-ui text-ink-3">
            <Spinner /> Looking for harnesses…
          </p>
        ) : (
          <div role="radiogroup" aria-label="Harness" className="grid grid-cols-2 gap-1.5">
            {rows.map((r) => (
              <HarnessOption key={r.harness} row={r} on={harness === r.harness} onPick={() => setHarness(r.harness)} disabled={busy} />
            ))}
          </div>
        )}
        {harness === "codex" && <p className="mt-2 text-meta leading-normal text-ink-3">Codex may ask once, in its window, to let kiwi join reach the relay. Allow it there.</p>}
      </Field>

      <Field label="Folder">
        <div role="radiogroup" aria-label="Folder" className="grid gap-1.5">
          {folders.map((f) => (
            <Option key={f} on={folder === f} onPick={() => setFolder(f)} disabled={busy}>
              <Icon icon={Folder01Icon} size={16} className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ui font-semibold text-ink">{f.split("/").filter(Boolean).at(-1) ?? f}</span>
                <span className="block truncate text-meta text-ink-3">{f.split("/").slice(0, -1).join("/") || "/"}</span>
              </span>
            </Option>
          ))}
          {machine === null ? (
            <button
              type="button"
              onClick={() => void choose()}
              disabled={busy}
              className="flex h-10 items-center gap-2 rounded-ctl px-3 text-left text-ui font-medium text-accent-text edge hover:bg-wash"
            >
              Choose a folder…
            </button>
          ) : (
            folders.length === 0 && !unreachable && <p className="text-meta leading-normal text-ink-3">No folders yet: an agent has to have joined this channel from that computer once.</p>
          )}
        </div>
      </Field>

      <Field label="Nickname">
        <TextField value={nick} onChange={(e) => setNick(e.target.value)} placeholder={harness ?? "Optional"} maxLength={40} aria-label="Nickname" disabled={busy} />
        {bad && <p className="mt-2 text-meta text-alert">{bad}</p>}
      </Field>

      <Field label="Personality">
        <PersonalityPicker value={persona} onChange={setPersona} lead={lead} disabled={busy} />
      </Field>

      {error && <p className="mt-4 rounded-ctl bg-wash px-3 py-2.5 text-ui leading-normal text-alert">{error}</p>}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !harness || !folder || !!bad}>
          {busy ? <Spinner className="border-white/30 border-t-white" /> : "Start"}
        </Button>
      </div>
    </form>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="pb-1.5 text-meta font-medium text-ink-3">{label}</p>
      {children}
    </div>
  )
}

function Option({ on, onPick, disabled, off, children }: { on: boolean; onPick: () => void; disabled?: boolean; off?: boolean; children: ReactNode }) {
  return (
    <label
      className={cx(
        "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-ctl px-3 py-1.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring",
        on ? "bg-accent-wash shadow-[inset_0_0_0_1.5px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--line)] hover:bg-wash",
        (disabled || off) && "cursor-default opacity-50 hover:bg-transparent"
      )}
    >
      <input type="radio" className="sr-only" checked={on} disabled={disabled || off} onChange={onPick} />
      {children}
      {on && <Icon icon={Tick02Icon} size={16} className="shrink-0 text-accent-text" />}
    </label>
  )
}

function HarnessOption({ row, on, onPick, disabled }: { row: HarnessRow; on: boolean; onPick: () => void; disabled?: boolean }) {
  const why = !row.path ? "Not installed" : !row.start ? "Can’t start it yet" : null
  return (
    <Option on={on} onPick={onPick} disabled={disabled} off={!!why}>
      <span className="size-7 shrink-0">
        <HarnessFace harness={row.harness} size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-semibold text-ink">{harnessName(row.harness)}</span>
        <span className="block truncate text-meta text-ink-3 tabular-nums">{why ?? row.version ?? "Installed"}</span>
      </span>
    </Option>
  )
}

function Progress({ started, seen, harness, on, onClose }: { started: Started; seen: LaunchSeen | null; harness: KnownHarness | null; on?: string | undefined; onClose: () => void }) {
  const place = started.place === "tmux" ? `tmux, window ${started.window} of session ${started.session}` : PLACE[started.place]
  const where = on ? `${place} on ${on}` : place
  const joined = seen?.stage === "joined" ? seen.name : null
  const steps: { done: boolean; text: string; detail?: ReactNode }[] = [
    {
      done: true,
      text: `Started in ${where}`,
      ...(started.place === "tmux" ? { detail: <code className="font-mono text-ink-2">tmux attach -t {started.session}</code> } : {}),
    },
    { done: !!seen, text: "Asked to join" },
    { done: !!joined, text: joined ? `Joined as @${joined}` : "Joins the channel" },
  ]
  return (
    <div className="p-5">
      <Dialog.Title className="text-title font-semibold">{joined ? `@${joined} joined` : `Starting ${harness ? harnessName(harness) : "the agent"}`}</Dialog.Title>
      <ol className="mt-4 space-y-2.5">
        {steps.map((s, i) => {
          const now = !s.done && steps.slice(0, i).every((p) => p.done)
          return (
            <li key={s.text} className="flex items-start gap-2.5">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center">
                {s.done ? <Icon icon={CheckmarkCircle02Icon} size={18} className="text-live" /> : now ? <Spinner /> : <span className="size-2 rounded-full bg-wash-2" />}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-ui", s.done ? "text-ink" : "text-ink-3")}>{s.text}</span>
                {s.detail && <span className="mt-0.5 block text-meta">{s.detail}</span>}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mt-5 flex items-center justify-end gap-2">
        {started.place === "rex" && !on && (
          <Button variant="secondary" onClick={() => void showInRex({ alias: "kiwi", agent: joined ?? "agent", ...started.rex })}>
            Show in Rex
          </Button>
        )}
        <Button onClick={onClose}>{joined ? "Done" : "Close"}</Button>
      </div>
    </div>
  )
}

function MachineLine({ label, detail, online }: { label: string; detail: string; online: boolean | null }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        {online !== null && <span aria-label={online ? "Online" : "Offline"} className={cx("size-2 shrink-0 rounded-full", online ? "bg-live" : "bg-wash-2")} />}
        <span className="truncate text-ui font-semibold text-ink">{label}</span>
      </span>
      <span className="block truncate text-meta text-ink-3">{detail}</span>
    </span>
  )
}
