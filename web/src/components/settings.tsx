import { ArrowLeft01Icon, ArrowRight01Icon, ComputerIcon, GithubIcon, Link01Icon, PaintBoardIcon, Robot01Icon, Settings02Icon, SparklesIcon, TerminalIcon } from "@hugeicons/core-free-icons"
import { useOwnPersonalities } from "@/lib/personalities"
import { Personalities } from "./personalities"

import { setAppearance, setTextSize, useAppearance, useTextSize, type Appearance, type TextSize } from "@/lib/theme"
import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { cx } from "@/lib/utils"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { relayUrl } from "@/lib/relay"
import { bridge, useSecrets } from "@/lib/secrets"
import type { RexStatus } from "@kiwi/core/terminals.ts"
import { version } from "../../../package.json"
import { ComputerRows } from "./computers"
import { HarnessFace } from "./harness-face"
import { Icon, type IconSvgElement } from "./icon"
import { Button, Checkbox, IconButton, Monogram, SEGMENTED, SEGMENT_OFF, SEGMENT_ON } from "./kit"
import { UpdateCheck } from "./update-check"

// Both apply at once and stay in this browser; nothing here leaves it.

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div data-item className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <p className="min-w-0 flex-1 text-ui font-medium text-ink">{label}</p>
      <div role="radiogroup" aria-label={label} className={cx("grid w-full gap-0.5 sm:w-auto", SEGMENTED)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("h-7 rounded-row px-3 text-ui font-medium transition-colors", value === o.value ? SEGMENT_ON : SEGMENT_OFF)}
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

function VoiceFields() {
  const b = bridge()
  const snap = useSecrets()
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  if (!b?.setVoiceKey) return null
  const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
  const save = () => {
    setError(null)
    b.setVoiceKey(key).catch(fail)
  }
  const clear = () => {
    setError(null)
    setKey("")
    b.setVoiceKey("").catch(fail)
  }
  const rooms = snap.channels.filter((c) => c.roomId)
  return (
    <Item
      tile={<HarnessFace harness="grok" size={18} />}
      title="Grok Voice"
      desc={
        snap.voice.configured
          ? "A key is saved on this Mac. Each channel stays off until you turn it on."
          : "An xAI key lets this Mac talk with Grok Voice. Each channel stays off until you turn it on."
      }
    >
      <label htmlFor="voice-key" className="mb-2 block text-ui font-medium text-ink">
        xAI key
      </label>
      <div className="flex gap-2">
        <input
          id="voice-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && save()}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-row border border-line bg-transparent px-2 font-mono text-ui text-ink"
        />
        <Button variant="secondary" onClick={save} disabled={!key.trim()}>
          Save
        </Button>
        {snap.voice.configured && (
          <Button variant="secondary" onClick={clear}>
            Remove
          </Button>
        )}
      </div>
      {rooms.length > 0 && (
        <div className="mt-4 grid gap-1">
          {rooms.map((c) => {
            const id = c.roomId
            if (!id) return null
            const on = snap.voice.consent[id] === true
            return (
              <label key={id} className="flex items-center gap-2 text-ui text-ink">
                <Checkbox
                  checked={on}
                  onChange={(e) => {
                    setError(null)
                    b.setVoiceConsent(id, e.target.checked).catch(fail)
                  }}
                />
                {c.name ?? c.label}
              </label>
            )
          })}
        </div>
      )}
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

function RexFields() {
  const b = bridge()
  const [status, setStatus] = useState<RexStatus | null>(null)
  const [busy, setBusy] = useState<"on" | "off" | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b?.rexStatus) return
    void b.rexStatus().then(setStatus, () => setStatus(null))
  }, [b])
  if (!b?.rexStatus || !status || (!status.found && status.helpers === "off")) return null
  const run = (to: "on" | "off", go: () => Promise<RexStatus>) => {
    setError(null)
    setBusy(to)
    go()
      .then(setStatus, (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
      .finally(() => setBusy(null))
  }
  const on = status.helpers === "on"
  const notes = [
    on && !status.found && "Rex isn't on this computer anymore. Remove takes back what Kiwi wrote.",
    on && status.found && status.server === "stopped" && "Rex isn't running. Kiwi picks it up once it starts.",
  ].filter((n): n is string => !!n)
  return (
    <Item
      tile={<span className="text-stamp font-bold tracking-tight">rex</span>}
      title="Rex"
      desc={
        on ? "Helpers on: a seat that needs you marks its Rex tab, and Needs you opens it." : "Mark a seat that needs you in its Rex tab, open it from Needs you, and let rotation work in Rex panes."
      }
      aside={
        on ? (
          <Button variant="secondary" disabled={busy !== null} onClick={() => run("off", b.rexRemove)}>
            {busy === "off" ? "Removing…" : "Remove"}
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy !== null} onClick={() => run("on", b.rexInstall)}>
            {busy === "on" ? "Installing…" : "Install Rex Helpers"}
          </Button>
        )
      }
    >
      {(notes.length > 0 || (on && status.rotation === "off") || error) && (
        <>
          {notes.map((n) => (
            <p key={n} className="text-ui text-ink-2">
              {n}
            </p>
          ))}
          {on && status.rotation === "off" && (
            <p className="text-ui text-ink-2">
              Rotation is off on this computer. <span className="font-mono text-ink">kiwi rotate on</span> turns it on.
            </p>
          )}
          {error && (
            <p className="mt-1 text-ui text-ink-2" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Item>
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

const SECTIONS: { id: string; label: string; icon: IconSvgElement }[] = [
  { id: "appearance", label: "Appearance", icon: PaintBoardIcon },
  { id: "agents", label: "Agents", icon: Robot01Icon },
  { id: "services", label: "Services", icon: Link01Icon },
  { id: "computers", label: "Computers", icon: ComputerIcon },
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
  const shown = SECTIONS.filter((s) => (s.id === "services" ? !!(b?.githubStatus || b?.setVoiceKey || b?.rexStatus) : s.id === "computers" ? !!person : true))
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
            </Group>
            <Group id="services" title="Services">
              <GithubFields />
              <VoiceFields />
              <RexFields />
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
