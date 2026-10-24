import { Dialog } from "@base-ui/react/dialog"
import { CancelCircleIcon, CheckmarkCircle02Icon, Folder01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react"

import type { HarnessRow, KnownHarness } from "@kiwi/core/harnesses.ts"
import type { Persona, Personality } from "@kiwi/core/personality.ts"
import { PLACE_NAMES, type LaunchedView } from "@kiwi/core/terminals.ts"
import type { FromMachine, MachineView } from "../../../desktop/src/bridge.ts"
import { harnessName } from "@/lib/harness"
import { followLaunch, sawMembers, type LaunchSeen } from "@/lib/launch-follow"
import { launcher } from "@/lib/launches"
import { usePersonalities } from "@/lib/personalities"
import { relayUrl } from "@/lib/relay"
import { showLabel, showSeat } from "@/lib/show-seat"
import { useLaunchesHere } from "@/lib/terminals"
import { cx } from "@/lib/utils"
import { HarnessFace } from "./harness-face"
import { Icon } from "./icon"
import { Button, errorText, Modal, Spinner, TextField } from "./kit"
import { PersonalityPicker } from "./personality-picker"

const NICK = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,39}$/u
const ASK_LATE_MS = 60_000
const JOIN_LATE_MS = 30_000
const OS: Record<string, string> = { darwin: "macOS", linux: "Linux", win32: "Windows" }

type StepId = "computer" | "harness" | "folder" | "name"
const STEP_LABEL: Record<StepId, string> = { computer: "Computer", harness: "Harness", folder: "Folder", name: "Name" }

function launchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const startable = (r: HarnessRow) => !!r.path && r.start
const folderName = (f: string) => f.split("/").filter(Boolean).at(-1) ?? f

type Started = Extract<LaunchedView, { ok: true }>
type Launch = { phase: "sending" } | { phase: "failed"; detail: string } | { phase: "started"; started: Started }

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
  const launchesHere = useLaunchesHere()
  const [machines, setMachines] = useState<MachineView[] | null>(() => (launcher()?.machines ? null : []))
  const [picked, setPicked] = useState<string | null>(null)
  const others = machines?.filter((m) => !m.own) ?? []
  const machine = picked ?? (launchesHere ? null : (others.find((m) => m.online !== false)?.machinePk ?? null))
  const ready = machine !== null || launchesHere === true
  const [rows, setRows] = useState<FromMachine<HarnessRow[]> | null>(null)
  const [rowsTry, setRowsTry] = useState(0)
  const [harness, setHarness] = useState<KnownHarness | null>(null)
  const [folders, setFolders] = useState<FromMachine<string[]> | null>(null)
  const [foldersTry, setFoldersTry] = useState(0)
  const [folder, setFolder] = useState<string | null>(null)
  const [nick, setNick] = useState("")
  const [persona, setPersona] = useState<Persona | null>(null)
  const [chosenStep, setStep] = useState<StepId | null>(null)
  const [launch, setLaunch] = useState<Launch | null>(null)
  const [seen, setSeen] = useState<LaunchSeen | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = launcher()?.machines
    if (!list) return
    let live = true
    void list().then(
      (got) => live && setMachines(got),
      () => live && setMachines([])
    )
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const b = launcher()
    if (!b || !ready) return
    let live = true
    const asked = machine && b.harnessesOn ? b.harnessesOn(machine) : b.harnesses().then((value) => ({ ok: true as const, value }))
    void asked.then(
      (got) => {
        if (!live) return
        setRows(got)
        if (got.ok) setHarness((h) => h ?? got.value.find(startable)?.harness ?? null)
      },
      (err: unknown) => live && setRows({ ok: false, detail: errorText(err) })
    )
    return () => {
      live = false
    }
  }, [machine, ready, rowsTry])

  useEffect(() => {
    const b = launcher()
    if (!b || !ready) return
    let live = true
    const asked = machine && b.foldersOn ? b.foldersOn(machine, roomId) : b.seatFolders(roomId).then((value) => ({ ok: true as const, value }))
    void asked.then(
      (got) => {
        if (!live) return
        setFolders(got)
        if (got.ok) setFolder((f) => f ?? got.value[0] ?? null)
      },
      (err: unknown) => live && setFolders({ ok: false, detail: errorText(err) })
    )
    return () => {
      live = false
    }
  }, [roomId, machine, ready, foldersTry])

  useEffect(() => () => stop.current?.(), [])
  useEffect(() => sawMembers(code, roster), [code, roster])

  const pickMachine = (pk: string | null) => {
    if (pk === machine) return
    setPicked(pk)
    setRows(null)
    setHarness(null)
    setFolders(null)
    setFolder(null)
  }
  const retryRows = () => {
    setRows(null)
    setRowsTry((n) => n + 1)
  }
  const retryFolders = () => {
    setFolders(null)
    setFoldersTry((n) => n + 1)
  }
  const remote = machine ? machines?.find((m) => m.machinePk === machine) : undefined
  const here = machines?.find((m) => m.own)
  const where = remote?.label ?? "this computer"

  const choose = async () => {
    const got = await launcher()?.chooseFolder()
    if (!got) return
    setFolders((was) => ({ ok: true, value: was?.ok ? (was.value.includes(got) ? was.value : [got, ...was.value]) : [got] }))
    setFolder(got)
  }

  const name = nick.trim()
  const bad = name && !NICK.test(name) ? "A nickname is up to 40 letters, digits, spaces, _ . or -, starting with a letter or digit." : null

  const steps: StepId[] = others.length > 0 ? ["computer", "harness", "folder", "name"] : ["harness", "folder", "name"]
  const step = chosenStep && steps.includes(chosenStep) ? chosenStep : (steps[0] ?? "harness")
  const at = steps.indexOf(step)
  const done: Record<StepId, boolean> = { computer: ready, harness: harness !== null, folder: folder !== null, name: !bad }
  const reachable = (i: number) => steps.slice(0, i).every((s) => done[s])

  useEffect(() => {
    const box = body.current
    box?.querySelector<HTMLElement>("input:not([type=radio]), input:checked")?.focus({ preventScroll: true })
  }, [step])

  const start = async () => {
    const b = launcher()
    if (!b || !harness || !folder || bad || !ready) return
    const id = launchId()
    setSeen(null)
    setLaunch({ phase: "sending" })
    stop.current?.()
    stop.current = followLaunch(code, id, (s) => setSeen((was) => (was?.stage === "joined" ? was : s)))
    const fail = (detail: string) => {
      stop.current?.()
      stop.current = null
      setLaunch({ phase: "failed", detail })
    }
    try {
      const chosen = persona ? all.find((p) => p.name === persona.name) : undefined
      const pin = chosen && onPin ? await onPin(chosen) : undefined
      const r = await b.launchAgent({
        ...(machine ? { machinePk: machine } : {}),
        launch: id,
        harness,
        folder,
        code,
        relay: relayUrl(),
        ...(name ? { nick: name } : {}),
        ...(pin ? { persona: pin } : {}),
      })
      if (r.ok) setLaunch({ phase: "started", started: r })
      else fail(r.detail || "Kiwi couldn’t start it.")
    } catch (err) {
      fail(errorText(err))
    }
  }

  const next = () => {
    if (!done[step]) return
    const after = steps[at + 1]
    if (after) setStep(after)
    else void start()
  }

  if (launch) return <Progress launch={launch} seen={seen} harness={harness} on={remote?.label} channel={channel} onBack={() => setLaunch(null)} onRetry={() => void start()} onClose={onClose} />

  if (machines === null || launchesHere === null)
    return (
      <Frame
        title="New agent"
        footer={
          <Button variant="secondary" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
        }
      >
        <Waiting>Looking for your computers…</Waiting>
      </Frame>
    )

  if (!launchesHere && others.length === 0)
    return (
      <div className="p-5">
        <Dialog.Title className="text-title font-semibold">New agent</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">Creating new agents is off on this computer. Settings → New agents turns it back on.</Dialog.Description>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    )

  const summary = [harness && harnessName(harness), folder && `in ${folderName(folder)}`, others.length > 0 && `on ${remote ? remote.label : (here?.label ?? "this computer")}`]
    .filter(Boolean)
    .join(" ")
  const back = steps[at - 1]

  return (
    <Frame
      title="New agent"
      description={`It starts in a terminal on ${where} and joins ${channel} by itself.`}
      onSubmit={next}
      bodyRef={body}
      nav={
        <nav aria-label="Steps" className="-mx-2 mt-3 flex items-center gap-1">
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              aria-current={s === step ? "step" : undefined}
              disabled={!reachable(i)}
              onClick={() => setStep(s)}
              className={cx(
                "relative h-9 rounded-row px-2 text-ui transition-colors hover:text-ink disabled:pointer-events-none disabled:text-ink-3",
                s === step ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-ink-2"
              )}
            >
              {STEP_LABEL[s]}
            </button>
          ))}
        </nav>
      }
      footer={
        <>
          <p className="min-w-0 flex-1 truncate text-meta text-ink-3">{summary}</p>
          {back ? (
            <Button variant="secondary" onClick={() => setStep(back)}>
              Back
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={!done[step]}>
            {at === steps.length - 1 ? "Start" : "Next"}
          </Button>
        </>
      }
    >
      {step === "computer" && (
        <>
          <div role="radiogroup" aria-label="Computer" className="grid grid-cols-2 gap-1.5">
            {launchesHere && (
              <Option on={machine === null} onPick={() => pickMachine(null)}>
                <MachineLine label={here?.label ?? "This computer"} detail="This computer" online={here ? here.online : true} />
              </Option>
            )}
            {others.map((m) => (
              <Option key={m.machinePk} on={machine === m.machinePk} onPick={() => pickMachine(m.machinePk)} off={m.online === false}>
                <MachineLine label={m.label} detail={m.online === false ? "Offline" : (OS[m.os] ?? m.os)} online={m.online} />
              </Option>
            ))}
          </div>
          {remote && <Quiet>Sent to {remote.label} through the relay, signed by you.</Quiet>}
          {!ready && <Quiet>None of your other computers is online.</Quiet>}
        </>
      )}

      {step === "harness" && (
        <Loaded got={rows} waiting={`Looking on ${where}…`} onRetry={retryRows}>
          {(list) => {
            const can = list.filter(startable)
            if (can.length === 0)
              return <Problem onRetry={retryRows}>Nothing on {where} can start an agent yet. Install Claude Code, Codex, Grok, MiMo Code or Kimi Code there, then try again.</Problem>
            return (
              <div role="radiogroup" aria-label="Harness" className="grid grid-cols-2 gap-1.5">
                {can.map((r) => (
                  <Option key={r.harness} on={harness === r.harness} onPick={() => setHarness(r.harness)}>
                    <span className="size-7 shrink-0">
                      <HarnessFace harness={r.harness} size={28} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui font-semibold text-ink">{harnessName(r.harness)}</span>
                      <span className="block truncate text-meta text-ink-3 tabular-nums">{r.version ?? "Installed"}</span>
                    </span>
                  </Option>
                ))}
              </div>
            )
          }}
        </Loaded>
      )}

      {step === "folder" && (
        <Loaded got={folders} waiting="Looking for folders…" onRetry={retryFolders}>
          {(list) => (
            <div role="radiogroup" aria-label="Folder" className="grid gap-1.5">
              {list.map((f) => (
                <Option key={f} on={folder === f} onPick={() => setFolder(f)}>
                  <Icon icon={Folder01Icon} size={16} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ui font-semibold text-ink">{folderName(f)}</span>
                    <span className="block truncate text-meta text-ink-3">{f.split("/").slice(0, -1).join("/") || "/"}</span>
                  </span>
                </Option>
              ))}
              {machine === null ? (
                <button
                  type="button"
                  onClick={() => void choose()}
                  className="flex h-10 items-center gap-2 rounded-ctl border border-line px-3 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash"
                >
                  Choose a folder…
                </button>
              ) : (
                list.length === 0 && (
                  <p className="text-ui leading-normal text-ink-2">
                    No folders on {where} yet: an agent has to join {channel} from there once.
                  </p>
                )
              )}
            </div>
          )}
        </Loaded>
      )}

      {step === "name" && (
        <div className="space-y-4">
          <Field label="Nickname">
            <TextField value={nick} onChange={(e) => setNick(e.target.value)} placeholder={harness ?? "Optional"} maxLength={40} aria-label="Nickname" />
            {bad && <p className="mt-2 text-meta text-alert">{bad}</p>}
          </Field>
          <Field label="Personality">
            <PersonalityPicker value={persona} onChange={setPersona} lead={lead} scroll={false} />
          </Field>
        </div>
      )}
    </Frame>
  )
}

function Frame({
  title,
  description,
  nav,
  footer,
  onSubmit,
  bodyRef,
  fit,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  nav?: ReactNode
  footer: ReactNode
  onSubmit?: () => void
  bodyRef?: Ref<HTMLDivElement>
  fit?: boolean
  children: ReactNode
}) {
  return (
    <form
      className={cx("flex flex-col", fit ? "max-h-[88svh]" : "h-[min(30rem,88svh)]")}
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit?.()
      }}
    >
      <div className={cx("shrink-0 px-5 pt-5", nav ? "border-b border-line" : "pb-1")}>
        <Dialog.Title className="text-title font-semibold">{title}</Dialog.Title>
        {description && <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">{description}</Dialog.Description>}
        {nav}
      </div>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-5">
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3.5">{footer}</div>
    </form>
  )
}

function Loaded<T>({ got, waiting, onRetry, children }: { got: FromMachine<T> | null; waiting: string; onRetry: () => void; children: (value: T) => ReactNode }) {
  if (!got) return <Waiting>{waiting}</Waiting>
  if (!got.ok)
    return (
      <Problem onRetry={onRetry} alert>
        {got.detail}
      </Problem>
    )
  return children(got.value)
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="flex h-10 items-center gap-2 text-ui text-ink-3">
      <Spinner /> {children}
    </p>
  )
}

function Problem({ children, onRetry, alert }: { children: ReactNode; onRetry: () => void; alert?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <p className={cx("min-w-0 flex-1 pt-1 text-ui leading-normal", alert ? "text-alert" : "text-ink-2")}>{children}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-meta leading-normal text-ink-3">{children}</p>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="pb-1.5 text-meta font-medium text-ink-3">{label}</p>
      {children}
    </div>
  )
}

function Option({ on, onPick, off, children }: { on: boolean; onPick: () => void; off?: boolean; children: ReactNode }) {
  return (
    <label
      className={cx(
        "flex min-h-12 cursor-pointer items-center gap-2.5 rounded-ctl border px-3 py-1.5 transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ring",
        on ? "border-accent bg-accent-wash" : "border-line hover:bg-wash",
        off && "cursor-default opacity-50 hover:bg-transparent"
      )}
    >
      <input type="radio" className="sr-only" checked={on} disabled={off} onChange={onPick} />
      {children}
      {on && <Icon icon={Tick02Icon} size={16} className="shrink-0 text-accent-text" />}
    </label>
  )
}

function Progress({
  launch,
  seen,
  harness,
  on,
  channel,
  onBack,
  onRetry,
  onClose,
}: {
  launch: Launch
  seen: LaunchSeen | null
  harness: KnownHarness | null
  on?: string | undefined
  channel: string
  onBack: () => void
  onRetry: () => void
  onClose: () => void
}) {
  const started = launch.phase === "started" ? launch.started : null
  const joined = seen?.stage === "joined" ? seen.name : null
  const stage = launch.phase === "failed" ? "failed" : !started ? "send" : !seen ? "ask" : !joined ? "join" : "done"
  const [lateAt, setLateAt] = useState<string | null>(null)
  useEffect(() => {
    if (stage !== "ask" && stage !== "join") return
    const t = window.setTimeout(() => setLateAt(stage), stage === "ask" ? ASK_LATE_MS : JOIN_LATE_MS)
    return () => window.clearTimeout(t)
  }, [stage])
  const late = lateAt === stage
  const who = harness ? harnessName(harness) : "the agent"
  const computer = on ?? "this computer"
  const place = started ? (started.place === "tmux" ? `${PLACE_NAMES.tmux}, window ${started.window} of session ${started.session}` : PLACE_NAMES[started.place]) : null
  const steps: { state: "done" | "now" | "failed" | "todo"; text: string; detail?: ReactNode }[] = [
    launch.phase === "failed"
      ? { state: "failed", text: `Didn’t start on ${computer}`, detail: <span className="text-ink-2">{launch.detail}</span> }
      : started
        ? {
            state: "done",
            text: `Started in ${on ? `${place} on ${on}` : place}`,
            ...(started.place === "tmux" ? { detail: <code className="font-mono text-ink-2">tmux attach -t {started.session}</code> } : {}),
          }
        : { state: "now", text: `Starting it on ${computer}` },
    seen
      ? { state: "done", text: "Asked to join" }
      : {
          state: stage === "ask" ? "now" : "todo",
          text: "Asks to join",
          ...(stage === "ask" && (late || harness === "codex")
            ? {
                detail: (
                  <>
                    {late && <span className="block text-decide">No word from it yet. Look at its window: it may be waiting on a sign-in or a question.</span>}
                    {harness === "codex" && <span className="block text-ink-3">Codex may ask, in its window, to let kiwi join reach the relay. Allow it there.</span>}
                  </>
                ),
              }
            : {}),
        },
    joined
      ? { state: "done", text: `Joined as @${joined}` }
      : {
          state: stage === "join" ? "now" : "todo",
          text: `Joins ${channel}`,
          ...(stage === "join" && late ? { detail: <span className="text-decide">It asked but isn’t in yet. If it’s waiting in Needs you, let it in there.</span> } : {}),
        },
  ]
  const rex = started?.place === "rex" && !on ? started : null
  return (
    <Frame
      fit
      title={joined ? `@${joined} joined` : launch.phase === "failed" ? `Couldn’t start ${who}` : `Starting ${who}`}
      footer={
        launch.phase === "failed" ? (
          <>
            <Button variant="secondary" className="ml-auto" onClick={onBack}>
              Back
            </Button>
            <Button onClick={onRetry}>Try again</Button>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-meta leading-normal text-ink-3">
              {!joined && (started ? "Closing this won’t stop it: it joins by itself." : `Sent to ${computer}: closing this won’t stop it.`)}
            </p>
            {rex && (
              <Button variant="secondary" onClick={() => void showSeat({ place: "rex", alias: "kiwi", agent: joined ?? "agent", ...rex.rex })}>
                {showLabel(rex.place)}
              </Button>
            )}
            <Button onClick={onClose}>{joined ? "Done" : "Close"}</Button>
          </>
        )
      }
    >
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.text} className="flex items-start gap-2.5">
            <span className="mt-px flex size-5 shrink-0 items-center justify-center">
              {s.state === "done" ? (
                <Icon icon={CheckmarkCircle02Icon} size={18} className="text-live" />
              ) : s.state === "failed" ? (
                <Icon icon={CancelCircleIcon} size={18} className="text-alert" />
              ) : s.state === "now" ? (
                <Spinner />
              ) : (
                <span className="size-2 rounded-full bg-wash-2" />
              )}
            </span>
            <span className="min-w-0">
              <span className={cx("block text-ui", s.state === "todo" ? "text-ink-3" : "text-ink")}>{s.text}</span>
              {s.detail && <span className="mt-0.5 block text-meta leading-normal">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Frame>
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
