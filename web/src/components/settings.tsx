import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ComputerIcon,
  GithubIcon,
  Link01Icon,
  PaintBoardIcon,
  Robot01Icon,
  Settings02Icon,
  SmartPhone01Icon,
  SparklesIcon,
  TerminalIcon,
} from "@hugeicons/core-free-icons"
import { useOwnPersonalities } from "@/lib/personalities"
import { Personalities } from "./personalities"

import { setAppearance, setTextSize, useAppearance, useTextSize, type Appearance, type TextSize } from "@/lib/theme"
import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { cx } from "@/lib/utils"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { relayUrl } from "@/lib/relay"
import { bridge, useSecrets } from "@/lib/secrets"
import { contextLineBridge, terminalsBridge } from "@/lib/terminals"
import type { TerminalId, TerminalRow, TerminalsStatus } from "@kiwi/core/terminals.ts"
import { version } from "../../../package.json"
import { ComputerRows } from "./computers"
import { PhoneRows } from "./phones"
import { Icon, type IconSvgElement } from "./icon"
import { Button, IconButton, Monogram, SEGMENTED, SEGMENT_OFF, SEGMENT_ON } from "./kit"
import { UpdateCheck } from "./update-check"

// Both apply at once and stay in this browser; nothing here leaves it.

function Choice<T extends string>({
  label,
  desc,
  value,
  options,
  onChange,
}: {
  label: string
  desc?: string
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div data-item className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">{label}</p>
        {desc && <p className="text-meta leading-snug text-ink-3">{desc}</p>}
      </div>
      <div role="radiogroup" aria-label={label} className={cx("grid w-full gap-0.5 sm:w-auto", SEGMENTED)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx("h-7 rounded-row px-3 text-ui font-medium transition-colors disabled:opacity-40", value === o.value ? SEGMENT_ON : SEGMENT_OFF)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Item({ tile, title, desc, aside, children }: { tile?: ReactNode; title: string; desc?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div data-item className="px-4 py-3">
      <div className="flex items-center gap-3">
        {tile && <span className="flex size-8 shrink-0 items-center justify-center rounded-row text-ink edge">{tile}</span>}
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-ink">{title}</p>
          {desc && <p className="text-meta leading-snug text-ink-3">{desc}</p>}
        </div>
        {aside}
      </div>
      {children && <div className={cx("mt-2.5", !!tile && "sm:pl-11")}>{children}</div>}
    </div>
  )
}

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} aria-label={title} className="scroll-mt-4 [&:not(:has([data-item]))]:hidden">
      <h2 className="px-1 pb-2 text-meta font-medium text-ink-3">{title}</h2>
      <div className="overflow-hidden rounded-card edge [&>*+*]:shadow-[inset_0_1px_0_var(--line)]">{children}</div>
    </section>
  )
}

type RelayBridge = { setRelayUrl?: (url: string) => Promise<string> }

// The relay this app talks to. Only the desktop app can change it; saving reloads the app on the new relay.
function RelayField() {
  const bridge = (window as unknown as { kiwi?: RelayBridge }).kiwi
  const [value, setValue] = useState(relayUrl())
  const [error, setError] = useState<string | null>(null)
  if (!bridge?.setRelayUrl) return null
  const save = () => {
    setError(null)
    bridge.setRelayUrl!(value.trim()).catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
  }
  return (
    <Item title="Relay" desc="Where this app's channels live. Changing it reloads the app.">
      <div className="flex gap-2">
        <input
          id="relay-url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-row border border-line bg-transparent px-2 font-mono text-ui text-ink"
        />
        <Button variant="secondary" onClick={save} disabled={value.trim() === relayUrl()}>
          Use
        </Button>
      </div>
      {error && (
        <p className="mt-1 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </Item>
  )
}

function GithubFields() {
  const b = bridge()
  const [status, setStatus] = useState<{ available: boolean; account: { login: string } | null } | null>(null)
  const [code, setCode] = useState<{ code: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b?.githubStatus) return
    void b.githubStatus().then(setStatus, () => setStatus(null))
    return b.onGithubCode(setCode)
  }, [b])
  if (!b?.githubStatus || !status || (!status.available && !status.account)) return null
  const run = (go: () => Promise<{ available: boolean; account: { login: string } | null }>) => {
    setError(null)
    setBusy(true)
    go()
      .then(setStatus, (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
      .finally(() => (setBusy(false), setCode(null)))
  }
  return (
    <Item
      tile={<Icon icon={GithubIcon} size={18} />}
      title="GitHub"
      desc={
        status.account
          ? `Linked as @${status.account.login}. Agents open pull requests; what has to come from you, like approving, comes from here.`
          : "Link your account so what has to come from you, like approving a pull request, can. Stays on this Mac."
      }
      aside={
        status.account ? (
          <Button variant="secondary" disabled={busy} onClick={() => run(b.githubUnlink)}>
            Unlink
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => run(b.githubLink)}>
            {busy ? "Waiting for GitHub…" : "Link GitHub"}
          </Button>
        )
      }
    >
      {!status.account && busy && code && (
        <p className="text-ui text-ink-2">
          Enter <span className="font-mono font-medium text-ink">{code.code}</span> at {code.url.replace(/^https:\/\//, "")}
        </p>
      )}
      {error && (
        <p className="mt-1 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </Item>
  )
}

const HELPERS: Record<"rex" | "tmux", { download: string; on: string; off: string }> = {
  rex: {
    download: "Download Rex Helpers",
    on: "Downloaded. A seat that needs you marks its Rex tab, and Needs you opens it.",
    off: "Marks a seat that needs you in its Rex tab, opens it from Needs you, and lets new agents open in Rex.",
  },
  tmux: {
    download: "Download Tmux Helpers",
    on: "Downloaded. A seat that needs you marks its window in tmux, and prefix K jumps to it.",
    off: "Marks a seat that needs you in tmux's window list, jumps to it with prefix K, and lets new agents open in tmux.",
  },
}

const PREFER_ORDER: TerminalId[] = ["app", "rex", "tmux"]

function NewAgentsFields() {
  const b = terminalsBridge()
  const [status, setStatus] = useState<TerminalsStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b) return
    void b.terminals().then(setStatus, () => setStatus(null))
  }, [b])
  if (!b || !status) return null
  const run = (key: string, go: () => Promise<TerminalsStatus | null>) => {
    if (busy) return
    setError(null)
    setBusy(key)
    go()
      .then(
        (next) => next && setStatus(next),
        (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
      )
      .finally(() => setBusy(null))
  }
  const rows = PREFER_ORDER.flatMap((id) => status.terminals.filter((t) => t.id === id))
  const helpers = rows.filter((t): t is TerminalRow & { id: "rex" | "tmux"; helpers: "on" | "off" } => t.id !== "app" && t.helpers !== null && (t.found || t.helpers === "on"))
  return (
    <>
      <Choice
        label="Allow creating new agents"
        desc="New agent starts an agent on this computer, from this app or from a computer paired with it."
        value={status.launch}
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        onChange={(to) => run("launch", () => b.setLaunches(to))}
      />
      <Choice
        label="Prefer"
        desc="Where a new agent opens. If it can't open there, it opens in Terminal."
        value={status.prefer}
        options={rows.map((t) => ({ value: t.id, label: t.name, disabled: t.id !== "app" && t.helpers !== "on" }))}
        onChange={(id) => run("prefer", () => b.terminalPrefer(id))}
      />
      {helpers.map((t) => {
        const on = t.helpers === "on"
        const note =
          on && !t.found ? `${t.name} isn't on this computer anymore. Remove takes back what Kiwi wrote.` : on && !t.running ? `${t.name} isn't running. Kiwi picks it up once it starts.` : null
        return (
          <Item
            key={t.id}
            tile={<span className="text-stamp font-bold tracking-tight">{t.id}</span>}
            title={t.name}
            desc={on ? HELPERS[t.id].on : HELPERS[t.id].off}
            aside={
              <Button variant="secondary" disabled={busy !== null} onClick={() => run(t.id, () => b.terminalHelpers(t.id, on ? "off" : "on"))}>
                {busy === t.id ? (on ? "Removing…" : "Downloading…") : on ? "Remove" : HELPERS[t.id].download}
              </Button>
            }
          >
            {note && <p className="text-ui text-ink-2">{note}</p>}
          </Item>
        )
      })}
      {error && (
        <div data-item className="px-4 py-3">
          <p className="text-ui text-ink-2" role="alert">
            {error}
          </p>
        </div>
      )}
    </>
  )
}

function PersonalitiesField({ onOpen }: { onOpen: () => void }) {
  const count = useOwnPersonalities().length
  return (
    <button data-item type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-wash">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-row text-ink edge">
        <Icon icon={SparklesIcon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium text-ink">Personalities</span>
        <span className="block text-meta leading-snug text-ink-3">Six presets for code work{count ? `, and ${count} of your own` : ""}. An agent takes one when you let it in.</span>
      </span>
      <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}

function KiwiHere() {
  const b = bridge()
  const [line, setLine] = useState<string | null>(null)
  useEffect(() => {
    if (!b?.daemonStatus || !b.harnesses) return
    let live = true
    void Promise.all([b.daemonStatus(), b.harnesses()]).then(
      ([daemon, rows]) => {
        const found = rows.filter((r) => r.path && r.start).map((r) => `${r.harness === "claude" ? "Claude Code" : r.harness === "codex" ? "Codex" : r.harness}${r.version ? ` ${r.version}` : ""}`)
        if (live) setLine([daemon.running && daemon.version ? `kiwi ${daemon.version}` : "kiwi isn't running", ...found].join(" · "))
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [b])
  if (!b?.daemonStatus || !b.harnesses || line === null) return null
  return <Item tile={<Icon icon={TerminalIcon} size={16} />} title="kiwi on this computer" desc={line} />
}

function ContextLineField() {
  const b = contextLineBridge()
  const [on, setOn] = useState<"on" | "off" | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b) return
    let live = true
    void b.contextLine().then(
      (got) => live && setOn(got),
      () => {}
    )
    return () => {
      live = false
    }
  }, [b])
  if (!b || on === null) return null
  const change = (to: "on" | "off") => {
    if (busy || to === on) return
    setError(null)
    setBusy(true)
    b.setContextLine(to)
      .then(
        (got) => (got ? setOn(got) : setError("kiwi didn't change it")),
        (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
      )
      .finally(() => setBusy(false))
  }
  return (
    <>
      <Choice
        label="Ask agents for a checkpoint past 250k context"
        desc="Off by default. On, an agent on this computer past 250k tokens is asked to write where its work stands before it ends its turn."
        value={on}
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        onChange={change}
      />
      {error && (
        <p className="px-4 pb-3 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </>
  )
}

const SECTIONS: { id: string; label: string; icon: IconSvgElement }[] = [
  { id: "appearance", label: "Appearance", icon: PaintBoardIcon },
  { id: "agents", label: "Agents", icon: Robot01Icon },
  { id: "new-agents", label: "New agents", icon: TerminalIcon },
  { id: "services", label: "Services", icon: Link01Icon },
  { id: "computers", label: "Computers", icon: ComputerIcon },
  { id: "phone", label: "Phone", icon: SmartPhone01Icon },
  { id: "app", label: "This app", icon: Settings02Icon },
]

function General({ onPersonalities }: { onPersonalities: () => void }) {
  const appearance = useAppearance()
  const size = useTextSize()
  const reduceMotion = useAccessibilityOption("reduce-motion")
  const { person } = useSecrets()
  const b = bridge()
  const [on, setOn] = useState("appearance")
  const [adding, setAdding] = useState(false)
  const [linking, setLinking] = useState(false)
  const shown = SECTIONS.filter((s) =>
    s.id === "services" ? !!b?.githubStatus : s.id === "new-agents" ? !!terminalsBridge() : s.id === "computers" ? !!person : s.id === "phone" ? !!person && !!b : true
  )
  const go = (id: string) => {
    setOn(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Settings sections" className="hidden w-[232px] shrink-0 flex-col gap-0.5 px-3 pt-2 md:flex">
        {person && (
          <div className="flex items-center gap-2.5 px-2 pb-4">
            <Monogram name={person.name} hue={person.name} agent={false} size={36} />
            <div className="min-w-0">
              <p className="truncate text-ui font-semibold">{person.name}</p>
              <p className="truncate text-meta text-ink-3">key {person.pk.slice(0, 8)}</p>
            </div>
          </div>
        )}
        {shown.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={on === s.id ? "true" : undefined}
            onClick={() => go(s.id)}
            className={cx(
              "flex h-9 items-center gap-2.5 rounded-row px-2.5 text-left text-ui transition-colors",
              on === s.id ? "bg-pick font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink"
            )}
          >
            <Icon icon={s.icon} size={16} className={on === s.id ? "text-ink" : "text-ink-3"} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-[680px] px-6 pt-2 pb-12 md:pl-10">
          <h1 className="text-display font-semibold tracking-[-0.014em]">Settings</h1>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-7">
            <Group id="appearance" title="Appearance">
              <Choice<Appearance>
                label="Theme"
                value={appearance}
                onChange={setAppearance}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
              <Choice<TextSize>
                label="Text size"
                value={size}
                onChange={setTextSize}
                options={[
                  { value: "small", label: "Small" },
                  { value: "default", label: "Default" },
                  { value: "large", label: "Large" },
                  { value: "larger", label: "Larger" },
                ]}
              />
              <Choice<"on" | "off">
                label="Motion"
                value={reduceMotion ? "on" : "off"}
                onChange={(v) => setAccessibilityOption("reduce-motion", v === "on")}
                options={[
                  { value: "off", label: "Full" },
                  { value: "on", label: "Reduced" },
                ]}
              />
            </Group>
            <Group id="agents" title="Agents">
              <PersonalitiesField onOpen={onPersonalities} />
              <KiwiHere />
              <ContextLineField />
            </Group>
            <Group id="new-agents" title="New agents">
              <NewAgentsFields />
            </Group>
            <Group id="services" title="Services">
              <GithubFields />
            </Group>
            {person && (
              <Group id="computers" title="Computers">
                <div data-item className="grid gap-1 px-4 py-2">
                  <p className="pt-1 text-meta leading-snug text-ink-3">Agents on a paired computer join your channels as yours. Removing one takes its agents out of the channels you own.</p>
                  <ComputerRows adding={adding} onAdded={() => setAdding(false)} />
                </div>
                {!adding && b && (
                  <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center px-4 py-3 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash">
                    Add a computer
                  </button>
                )}
              </Group>
            )}
            {person && b && (
              <Group id="phone" title="Phone">
                <div data-item className="grid gap-1 px-4 py-2">
                  <p className="pt-1 text-meta leading-snug text-ink-3">
                    Your phone reads and answers your channels as you. Linking hands it your person and channel keys, end to end through the relay.
                  </p>
                  <PhoneRows linking={linking} onLinked={() => setLinking(false)} />
                </div>
                {!linking && (
                  <button type="button" onClick={() => setLinking(true)} className="flex w-full items-center px-4 py-3 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash">
                    Link a phone
                  </button>
                )}
              </Group>
            )}
            <Group id="app" title="This app">
              <UpdateCheck />
              <RelayField />
              <Item title="Version" desc={`Channels ${version}`} />
            </Group>
          </div>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage({ backTo, onClose }: { backTo: string; onClose: () => void }) {
  const [view, setView] = useState<"general" | "personalities">("general")
  const self = useRef<HTMLElement>(null)
  const inner = view === "personalities"
  const back = inner ? () => setView("general") : onClose
  useLayoutEffect(() => {
    const prev = document.activeElement
    self.current?.focus({ preventScroll: true })
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus()
    }
  }, [])
  return (
    <section
      ref={self}
      tabIndex={-1}
      aria-label={inner ? "Personalities" : "Settings"}
      className="animate-rise flex h-full w-full min-w-0 flex-col outline-none"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || e.defaultPrevented) return
        e.preventDefault()
        back()
      }}
    >
      <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 px-3">
        <IconButton label={inner ? "Back to Settings" : "Close settings"} round className="glass size-9 text-ink" onClick={back}>
          <Icon icon={ArrowLeft01Icon} size={18} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{inner ? "Settings" : backTo}</span>
      </header>
      {inner ? <Personalities /> : <General onPersonalities={() => setView("personalities")} />}
    </section>
  )
}
