import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  ColorsIcon,
  CommandLineIcon,
  ComputerIcon,
  ComputerRemoveIcon,
  Folder01Icon,
  FolderAddIcon,
  GithubIcon,
  InformationCircleIcon,
  Link01Icon,
  Motion02Icon,
  Note01Icon,
  PaintBoardIcon,
  Robot01Icon,
  ServerStack01Icon,
  Settings02Icon,
  Shield01Icon,
  SmartPhone01Icon,
  SparklesIcon,
  StethoscopeIcon,
  Sun03Icon,
  TerminalIcon,
  TextFontIcon,
  TransparencyIcon,
  UserAdd01Icon,
  WebhookIcon,
} from "@hugeicons/core-free-icons"
import { useOwnPersonalities } from "@/lib/personalities"
import { Personalities } from "./personalities"

import { ACCENT_TINT, setAppearance, setTextSize, setTint, useAccent, useAppearance, useTextSize, useTint, type Appearance, type TextSize } from "@/lib/theme"
import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { cx } from "@/lib/utils"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { relayUrl } from "@/lib/relay"
import { bridge, useSecrets, type KiwiBridge } from "@/lib/secrets"
import { contextLineBridge, hooksBridge, terminalsBridge } from "@/lib/terminals"
import { rootsBridge } from "@/lib/launches"
import { harnessName } from "@/lib/harness"
import type { HarnessRow, HookRow, HookState } from "@kiwi/core/harnesses.ts"
import type { TerminalId, TerminalRow, TerminalsStatus } from "@kiwi/core/terminals.ts"
import { version } from "../../../package.json"
import { ComputerRows } from "./computers"
import { HarnessFace } from "./harness-face"
import { PhoneRows } from "./phones"
import { Icon, type IconSvgElement } from "./icon"
import { Button, IconButton, SEGMENTED, SEGMENT_OFF, SEGMENT_ON, TextField } from "./kit"
import { PlaceHead, usePlaceSlot } from "./shell-sidebar"
import { UpdateCheck } from "./update-check"

// Both apply at once and stay in this browser; nothing here leaves it.

function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("flex size-5 shrink-0 items-center justify-center text-ink-2", className)}>{children}</span>
}

const glyph = (icon: IconSvgElement) => <Icon icon={icon} size={16} />

function useWallpaperTints(appearance: Appearance): string[] {
  const [tints, setTints] = useState<string[]>([])
  useEffect(() => {
    const b = bridge()
    if (!b?.wallpaperTints) return
    let live = true
    const dark = appearance === "dark" || (appearance === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
    const load = () =>
      void b.wallpaperTints(dark).then(
        (got) => live && setTints(got),
        () => {}
      )
    load()
    window.addEventListener("focus", load)
    return () => {
      live = false
      window.removeEventListener("focus", load)
    }
  }, [appearance])
  return tints
}

function Swatch({ color, on, label, onPick }: { color: string | null; on: boolean; label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onPick}
      className={cx(
        "flex size-6 items-center justify-center rounded-full transition-shadow",
        on ? "shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--ink)]" : "hover:shadow-[0_0_0_2px_var(--canvas),0_0_0_4px_var(--edge-strong)]"
      )}
    >
      {color ? (
        <span className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" style={{ background: color }} />
      ) : (
        <span className="size-6 rounded-full bg-[linear-gradient(135deg,transparent_45%,var(--ink-3)_45%,var(--ink-3)_55%,transparent_55%)] shadow-[inset_0_0_0_1px_var(--edge-strong)]" />
      )}
    </button>
  )
}

function TintField({ appearance }: { appearance: Appearance }) {
  const tint = useTint()
  const tints = useWallpaperTints(appearance)
  const accent = useAccent()
  const followsAccent = !!bridge()?.getAccentColor && (accent !== null || tint === ACCENT_TINT)
  const shown = tint && tint !== ACCENT_TINT && !tints.includes(tint) ? [tint, ...tints] : tints
  if (!shown.length && !followsAccent) return null
  return (
    <div data-item className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <Lead>{glyph(ColorsIcon)}</Lead>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">Tint</p>
        <p className="text-meta leading-snug text-ink-3">{followsAccent ? "Your system accent, or the main colours of your wallpaper" : "The main colours of your wallpaper"}</p>
      </div>
      <div role="radiogroup" aria-label="Tint" className="flex items-center gap-2.5">
        <Swatch color={null} on={!tint} label="No tint" onPick={() => setTint(null)} />
        {followsAccent && <Swatch color={accent ?? "var(--accent)"} on={tint === ACCENT_TINT} label="System accent" onPick={() => setTint(ACCENT_TINT)} />}
        {shown.map((t) => (
          <Swatch key={t} color={t} on={tint === t} label={`Tint ${t}`} onPick={() => setTint(t)} />
        ))}
      </div>
    </div>
  )
}

function Choice<T extends string>({
  tile,
  label,
  desc,
  value,
  options,
  onChange,
}: {
  tile: ReactNode
  label: string
  desc?: string
  value: T
  options: { value: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div data-item className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <Lead>{tile}</Lead>
      <div className="min-w-0 flex-1">
        <p className="text-ui font-medium text-ink">{label}</p>
        {desc && <p className="text-meta leading-snug text-ink-3">{desc}</p>}
      </div>
      <div role="radiogroup" aria-label={label} className={cx("grid h-(--control) w-full gap-0.5 sm:w-auto", SEGMENTED)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx("h-full rounded-row px-3 text-ui font-medium transition-colors disabled:opacity-40", value === o.value ? SEGMENT_ON : SEGMENT_OFF)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Item({ tile, title, desc, aside, children }: { tile: ReactNode; title: string; desc?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <div data-item className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Lead>{tile}</Lead>
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-ink">{title}</p>
          {desc && <p className="text-meta leading-snug text-ink-3">{desc}</p>}
        </div>
        {aside}
      </div>
      {children && <div className="mt-2.5 pl-8">{children}</div>}
    </div>
  )
}

function Action({ icon, label, disabled, onClick }: { icon: IconSvgElement; label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      data-item
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-3 text-left text-ui font-medium text-accent-text transition-colors hover:bg-wash disabled:opacity-40"
    >
      <Lead className="text-accent-text">{glyph(icon)}</Lead>
      {label}
    </button>
  )
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <div data-item className="py-3 pr-4 pl-12">
      <p className="text-ui text-ink-2" role="alert">
        {children}
      </p>
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
    <Item tile={glyph(ServerStack01Icon)} title="Relay" desc="Where this app's channels live. Changing it reloads the app.">
      <div className="flex items-center gap-2">
        <TextField
          id="relay-url"
          aria-label="Relay"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          spellCheck={false}
          className="min-w-0 flex-1 font-mono"
        />
        <Button size="sm" variant="secondary" onClick={save} disabled={value.trim() === relayUrl()}>
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
      tile={glyph(GithubIcon)}
      title="GitHub"
      desc={
        status.account
          ? `Linked as @${status.account.login}. Agents open pull requests; what has to come from you, like approving, comes from here.`
          : "Link your account so what has to come from you, like approving a pull request, can. Stays on this Mac."
      }
      aside={
        status.account ? (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(b.githubUnlink)}>
            Unlink
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(b.githubLink)}>
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
  const setBypass = b.setRemoteBypass
  const rows = PREFER_ORDER.flatMap((id) => status.terminals.filter((t) => t.id === id))
  const helpers = rows.filter((t): t is TerminalRow & { id: "rex" | "tmux"; helpers: "on" | "off" } => t.id !== "app" && t.helpers !== null && (t.found || t.helpers === "on"))
  return (
    <>
      <Choice
        tile={glyph(UserAdd01Icon)}
        label="Allow creating new agents"
        desc="New agent starts an agent on this computer, from this app or from a computer paired with it."
        value={status.launch}
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        onChange={(to) => run("launch", () => b.setLaunches(to))}
      />
      {setBypass && status.launch === "on" && (
        <Choice
          tile={glyph(Shield01Icon)}
          label="Allow bypass from your other devices"
          desc="An agent started from your phone or another computer may skip its harness's permission prompts here. Off keeps every prompt."
          value={status.bypass}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
          ]}
          onChange={(to) => run("bypass", () => setBypass(to))}
        />
      )}
      <Choice
        tile={glyph(CommandLineIcon)}
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
            tile={glyph(TerminalIcon)}
            title={t.name}
            desc={on ? HELPERS[t.id].on : HELPERS[t.id].off}
            aside={
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(t.id, () => b.terminalHelpers(t.id, on ? "off" : "on"))}>
                {busy === t.id ? (on ? "Removing…" : "Downloading…") : on ? "Remove" : HELPERS[t.id].download}
              </Button>
            }
          >
            {note && <p className="text-ui text-ink-2">{note}</p>}
          </Item>
        )
      })}
      {error && <Problem>{error}</Problem>}
    </>
  )
}

function LaunchFoldersField() {
  const b = rootsBridge()
  const [roots, setRoots] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b) return
    let live = true
    void b.launchRoots().then(
      (got) => live && setRoots(got),
      () => live && setRoots([])
    )
    return () => {
      live = false
    }
  }, [b])
  if (!b || roots === null) return null
  const run = (key: string, go: () => Promise<string[]>) => {
    if (busy) return
    setError(null)
    setBusy(key)
    go()
      .then(setRoots, (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
      .finally(() => setBusy(null))
  }
  const add = async () => {
    const dir = await b.chooseFolder()
    if (dir) run("add", () => b.setLaunchRoot(dir, "add"))
  }
  return (
    <>
      <Item
        tile={glyph(Folder01Icon)}
        title="Folders agents can start in"
        desc="New agent, here or from your phone, can start one in these folders and the folders inside them, as well as where agents on this computer already work and your home folder's git repos."
      />
      {roots.map((dir) => (
        <Item
          key={dir}
          tile={glyph(Folder01Icon)}
          title={dir.split("/").filter(Boolean).at(-1) ?? dir}
          desc={dir}
          aside={
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => run(dir, () => b.setLaunchRoot(dir, "remove"))}>
              {busy === dir ? "Removing…" : "Remove"}
            </Button>
          }
        />
      ))}
      <Action icon={FolderAddIcon} label={busy === "add" ? "Adding…" : "Add a folder…"} disabled={busy !== null} onClick={() => void add()} />
      {error && <Problem>{error}</Problem>}
    </>
  )
}

function PersonalitiesField({ onOpen }: { onOpen: () => void }) {
  const count = useOwnPersonalities().length
  return (
    <button data-item type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-wash">
      <Lead>{glyph(SparklesIcon)}</Lead>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium text-ink">Personalities</span>
        <span className="block text-meta leading-snug text-ink-3">Six presets for code work{count ? `, and ${count} of your own` : ""}. An agent takes one when you let it in.</span>
      </span>
      <Icon icon={ArrowRight01Icon} size={14} className="shrink-0 text-ink-3" />
    </button>
  )
}

type Daemon = Awaited<ReturnType<KiwiBridge["daemonStatus"]>>
type Finding = NonNullable<Awaited<ReturnType<KiwiBridge["doctor"]>>>[number]

function abilities(r: HarnessRow): string {
  if (r.start && r.wake) return "Starts · Wakes"
  if (r.start) return "Starts"
  return r.wake ? "Wakes" : "Found"
}

function KiwiHere() {
  const b = bridge()
  const [daemon, setDaemon] = useState<Daemon | null>(null)
  const [rows, setRows] = useState<HarnessRow[] | null>(null)
  useEffect(() => {
    if (!b?.daemonStatus || !b.harnesses) return
    let live = true
    void Promise.all([b.daemonStatus(), b.harnesses()]).then(
      ([d, r]) => {
        if (!live) return
        setDaemon(d)
        setRows(r)
      },
      () => {}
    )
    return () => {
      live = false
    }
  }, [b])
  if (!b?.daemonStatus || !b.harnesses || daemon === null || rows === null) return null
  const found = rows.filter((r) => r.path)
  const missing = rows.filter((r) => !r.path)
  return (
    <>
      <Item tile={glyph(TerminalIcon)} title="kiwi on this computer" desc={daemon.running && daemon.version ? `kiwi ${daemon.version}, running` : "kiwi isn't running"} />
      {found.map((r) => (
        <Item
          key={r.harness}
          tile={<HarnessFace harness={r.harness} size={20} />}
          title={`${harnessName(r.harness)}${r.version ? ` ${r.version}` : ""}`}
          desc={
            <>
              <span className="block truncate font-mono" title={r.path ?? undefined}>
                {r.path}
              </span>
              {!r.start && r.why && <span className="block">{r.why}</span>}
            </>
          }
          aside={<span className="shrink-0 text-meta text-ink-3">{abilities(r)}</span>}
        />
      ))}
      {missing.length > 0 && <Item tile={glyph(ComputerRemoveIcon)} title="Not on this computer" desc={missing.map((r) => harnessName(r.harness)).join(", ")} />}
    </>
  )
}

function FindingRow({ f }: { f: Finding }) {
  if (!f.ok) {
    return (
      <li className="flex gap-2.5">
        <span className="flex h-[1lh] w-3.5 shrink-0 items-center justify-center text-meta leading-snug">
          <span className="size-2 rounded-full bg-alert" />
        </span>
        <span className="min-w-0 text-meta leading-snug">
          <span className="block text-ink">{f.what}</span>
          <span className="block text-ink-2">{f.how}</span>
        </span>
      </li>
    )
  }
  const [, label, value] = /^(\S+)\s{2,}(.*)$/.exec(f.what) ?? [null, null, f.what]
  return (
    <li className="flex gap-2.5 text-meta leading-snug">
      <Icon icon={CheckmarkCircle02Icon} size={14} className="mt-px shrink-0 text-live" />
      {label && <span className="w-14 shrink-0 text-ink-3">{label}</span>}
      <span className="min-w-0 break-words text-ink-2">{value}</span>
    </li>
  )
}

function Doctor() {
  const b = bridge()
  const [state, setState] = useState<"idle" | "running" | "failed" | Finding[]>("idle")
  if (!b?.doctor) return null
  const doctor = b.doctor
  const run = () => {
    setState("running")
    void doctor().then(
      (f) => setState(f ?? "failed"),
      () => setState("failed")
    )
  }
  const problems = Array.isArray(state) ? state.filter((f) => !f.ok).length : 0
  return (
    <Item
      tile={glyph(StethoscopeIcon)}
      title="Check this computer"
      desc={Array.isArray(state) ? (problems ? `${problems} to fix` : "Nothing to fix") : "Looks at kiwi's install, the relay, pairing and hooks, and says how to fix what isn't right."}
      aside={
        <Button size="sm" variant="secondary" disabled={state === "running"} onClick={run}>
          {state === "running" ? "Checking…" : Array.isArray(state) ? "Check Again" : "Check"}
        </Button>
      }
    >
      {Array.isArray(state) && (
        <ul className="grid gap-1.5">
          {state.map((f) => (
            <FindingRow key={f.what} f={f} />
          ))}
        </ul>
      )}
      {state === "failed" && <p className="text-meta text-ink-2">kiwi doctor didn't answer. Run it in a terminal to see why: kiwi doctor</p>}
    </Item>
  )
}

const HOOK_SAYS: Record<Exclude<HookState, "absent">, { desc: string; action: string; busy: string }> = {
  installed: { desc: "Installed", action: "Remove", busy: "Removing…" },
  partial: { desc: "Installed, but it can't wake Claude Code when a message comes", action: "Update", busy: "Updating…" },
  outdated: { desc: "From an older kiwi: update them", action: "Update", busy: "Updating…" },
  missing: { desc: "Not installed", action: "Install", busy: "Installing…" },
  off: { desc: "Removed. Kiwi won't add them back until you install them", action: "Install", busy: "Installing…" },
}

function HooksField() {
  const b = hooksBridge()
  const [rows, setRows] = useState<HookRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b) return
    let live = true
    void b.hooks().then(
      (got) => live && setRows(got),
      (e: unknown) => live && (setRows([]), setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
    )
    return () => {
      live = false
    }
  }, [b])
  if (!b) return null
  const change = (r: HookRow) => {
    if (busy) return
    setError(null)
    setBusy(r.harness)
    b.setHooks(r.harness, r.state === "installed" ? "off" : "on")
      .then(
        (got) => setRows(got),
        (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
      )
      .finally(() => setBusy(null))
  }
  const here = (rows ?? []).filter((r): r is HookRow & { state: Exclude<HookState, "absent"> } => r.state !== "absent")
  return (
    <>
      <Item
        tile={glyph(WebhookIcon)}
        title="Hooks"
        desc={
          rows === null
            ? "Looking at the harnesses on this computer…"
            : here.length
              ? "Hooks bring new messages to the agents on this computer and their permission prompts to Needs you."
              : "No harness on this computer takes hooks."
        }
      />
      {here.map((r) => {
        const says = HOOK_SAYS[r.state]
        return (
          <Item
            key={r.harness}
            tile={<HarnessFace harness={r.harness} size={20} />}
            title={harnessName(r.harness)}
            desc={says.desc}
            aside={
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => change(r)}>
                {busy === r.harness ? says.busy : says.action}
              </Button>
            }
          />
        )
      })}
      {error && <Problem>{error}</Problem>}
    </>
  )
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
        tile={glyph(Note01Icon)}
        label="Ask agents for a checkpoint past 250k context"
        desc="Off by default. On, an agent on this computer past 250k tokens is asked to write where its work stands before it ends its turn."
        value={on}
        options={[
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ]}
        onChange={change}
      />
      {error && <Problem>{error}</Problem>}
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

function General({ onPersonalities, onClose }: { onPersonalities: () => void; onClose: () => void }) {
  const appearance = useAppearance()
  const size = useTextSize()
  const reduceMotion = useAccessibilityOption("reduce-motion")
  const reduceTransparency = useAccessibilityOption("reduce-transparency")
  const { person } = useSecrets()
  const b = bridge()
  const [on, setOn] = useState("appearance")
  const place = usePlaceSlot()
  const shown = SECTIONS.filter((s) =>
    s.id === "services" ? !!b?.githubStatus : s.id === "new-agents" ? !!terminalsBridge() : s.id === "computers" ? !!person : s.id === "phone" ? !!person && !!b : true
  )
  const go = (id: string) => {
    setOn(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
  return (
    <div className="flex min-h-0 flex-1">
      {place &&
        createPortal(
          <>
            <PlaceHead title="Settings" back="Close settings" onBack={onClose} />
            <nav aria-label="Settings sections" className="mt-(--step) flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
              {shown.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={on === s.id ? "true" : undefined}
                  onClick={() => go(s.id)}
                  className={cx(
                    "flex h-9 w-full items-center gap-2.5 rounded-ctl px-3 text-left text-ui transition-colors",
                    on === s.id ? "bg-(--chosen) font-semibold text-ink" : "text-ink-2 hover:bg-wash hover:text-ink"
                  )}
                >
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <Icon icon={s.icon} size={16} className={on === s.id ? "text-ink" : "text-ink-3"} />
                  </span>
                  {s.label}
                </button>
              ))}
            </nav>
          </>,
          place
        )}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[680px] px-6 pt-(--step) pb-12">
          <h1 className="text-display font-semibold tracking-[-0.014em] md:sr-only">Settings</h1>
          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-7 md:mt-0">
            <Group id="appearance" title="Appearance">
              <Choice<Appearance>
                tile={glyph(Sun03Icon)}
                label="Theme"
                value={appearance}
                onChange={setAppearance}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
              <TintField appearance={appearance} />
              <Choice<TextSize>
                tile={glyph(TextFontIcon)}
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
                tile={glyph(Motion02Icon)}
                label="Motion"
                value={reduceMotion ? "on" : "off"}
                onChange={(v) => setAccessibilityOption("reduce-motion", v === "on")}
                options={[
                  { value: "off", label: "Full" },
                  { value: "on", label: "Reduced" },
                ]}
              />
              <Choice<"on" | "off">
                tile={glyph(TransparencyIcon)}
                label="Transparency"
                desc="Reduced makes the sidebar and toolbar solid"
                value={reduceTransparency ? "on" : "off"}
                onChange={(v) => setAccessibilityOption("reduce-transparency", v === "on")}
                options={[
                  { value: "off", label: "Full" },
                  { value: "on", label: "Reduced" },
                ]}
              />
            </Group>
            <Group id="agents" title="Agents">
              <PersonalitiesField onOpen={onPersonalities} />
              <KiwiHere />
              <Doctor />
              <HooksField />
              <ContextLineField />
            </Group>
            <Group id="new-agents" title="New agents">
              <NewAgentsFields />
              <LaunchFoldersField />
            </Group>
            <Group id="services" title="Services">
              <GithubFields />
            </Group>
            {person && (
              <Group id="computers" title="Computers">
                <Item
                  tile={glyph(ComputerIcon)}
                  title="Your computers"
                  desc="Agents on one of your computers join your channels as yours. To add one, run kiwi login on it. Removing one takes its agents out of the channels you own."
                >
                  <div className="grid gap-1">
                    <ComputerRows />
                  </div>
                </Item>
              </Group>
            )}
            {person && b && (
              <Group id="phone" title="Phone">
                <Item tile={glyph(SmartPhone01Icon)} title="Linked phones" desc="Your phone reads and answers your channels as you. Sign in on it, then type the digits it shows here.">
                  <div className="grid gap-1">
                    <PhoneRows />
                  </div>
                </Item>
              </Group>
            )}
            <Group id="app" title="This app">
              <UpdateCheck />
              <RelayField />
              <Item tile={glyph(InformationCircleIcon)} title="Version" desc={`Channels ${version}`} />
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
      <div aria-hidden className="drag hidden h-(--card-head) shrink-0 md:mt-(--step) md:block" />
      <header className="drag flex h-(--chrome-h) shrink-0 items-center gap-2 px-3 md:hidden">
        <IconButton label={inner ? "Back to Settings" : "Close settings"} round className="glass size-9 text-ink" onClick={back}>
          <Icon icon={ArrowLeft01Icon} size={18} />
        </IconButton>
        <span className="min-w-0 flex-1 truncate text-ui font-semibold">{inner ? "Settings" : backTo}</span>
      </header>
      {inner ? <Personalities onBack={back} /> : <General onPersonalities={() => setView("personalities")} onClose={onClose} />}
    </section>
  )
}
