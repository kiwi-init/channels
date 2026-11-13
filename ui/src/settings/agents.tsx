import "~/i18n/en/settings"

import { useState, type ReactNode } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { failedToast } from "~/kit/failed"
import { LOGOS } from "~/kit/logos"
import { RoleFace } from "~/kit/role-face"
import type { Finding, Harness, ThisComputer } from "~/model"
import { useApp } from "~/nav"
import { Personalities } from "~/settings/personalities"
import { acts, esc, field, fine, join, row, say, Sheet, toggle, words, type Acts } from "~/settings/sheet"

type Hook = ThisComputer["hooks"][number]

const REMOVE = { action: "settings.agents.hooks.remove", label: "settings.agents.hooks.remove.for" } as const
const UPDATE = { action: "settings.agents.hooks.update", label: "settings.agents.hooks.update.for" } as const
const ADD = { action: "settings.agents.hooks.add", label: "settings.agents.hooks.add.for" } as const

const HOOK_SAYS: Record<Hook["state"], { state: Key; action: Key; label: Key; loud?: boolean; why?: Key }> = {
  installed: { state: "settings.agents.hooks.on", ...REMOVE },
  partial: { state: "settings.agents.hooks.old", ...UPDATE, loud: true, why: "settings.agents.hooks.why.partial" },
  outdated: { state: "settings.agents.hooks.old", ...UPDATE, loud: true, why: "settings.agents.hooks.why.outdated" },
  missing: { state: "settings.agents.hooks.none", ...ADD },
  off: { state: "settings.agents.hooks.none", ...ADD, why: "settings.agents.hooks.why.off" },
}

function HarnessMark({ harness }: { harness: Harness }) {
  const logo = LOGOS[harness]
  if (!logo)
    return (
      <span className="set-harness-mark is-face" aria-hidden="true">
        <RoleFace harness={undefined} />
      </span>
    )
  return (
    <svg className="set-harness-mark" viewBox="0 0 24 24" data-harness={harness} aria-hidden="true">
      {logo.map((p, i) => (
        <path key={i} d={p.d} transform={p.transform} fillRule={p.rule} opacity={p.opacity} />
      ))}
    </svg>
  )
}

type Check = "idle" | "running" | "failed" | Finding[]

function kiwiState(computer: ThisComputer | null): string {
  if (!computer) return ""
  if (!computer.kiwi.running) return t("settings.agents.kiwi.stopped")
  return computer.kiwi.version ? t("settings.agents.kiwi.running.version", { version: computer.kiwi.version }) : t("settings.agents.kiwi.running")
}

function findingRow(f: Finding): string {
  if (!f.ok) return row({ mark: "bad", label: f.what, hint: esc(f.how) })
  const [, label, value] = /^(\S+)\s{2,}(.*)$/.exec(f.what) ?? []
  return label && value ? row({ mark: "fine", label, hint: esc(value) }) : row({ mark: "fine", label: f.what })
}

function hookRow(harness: Harness, label: string, version: string | undefined, path: string | undefined, hook: Hook | undefined, a: Acts, change: (hook: Hook) => void): string {
  const says = hook ? HOOK_SAYS[hook.state] : undefined
  const shown = says ? (says.why ? words(esc(t(says.state)), { tip: t(says.why) }) : esc(t(says.state))) : ""
  const state = says?.loud ? `**${shown}**` : `*${shown}*`
  return row({
    mark: `harness:${harness}`,
    label,
    tag: version,
    hint: path ? esc(path) : "",
    line: hook && says ? `${state} ${a.act(t(says.action), () => change(hook), { tip: t("settings.agents.hooks.do"), label: t(says.label, { harness: hook.label }) })}` : "",
  })
}

function checkRow(check: Check, a: Acts, run: () => void): string {
  const found = Array.isArray(check) ? check : null
  const problems = found ? found.filter((f) => !f.ok).length : 0
  return row({
    label: t("settings.agents.check"),
    hint: found
      ? problems
        ? say("settings.agents.check.problems", { count: problems })
        : say("settings.agents.check.fine")
      : check === "failed"
        ? say("settings.agents.check.failed", {}, { command: "kiwi doctor" })
        : say("settings.agents.check.hint"),
    line: a.act(check === "running" ? t("settings.sections.checking") : found ? t("settings.agents.check.again") : t("settings.agents.check.run"), () => {
      if (check !== "running") run()
    }),
    nested: found ? [found.map(findingRow).join("\n")] : [],
  })
}

export function AgentsPage() {
  const { app } = useApp()
  const [check, setCheck] = useState<Check>("idle")
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  const { computer, actions } = app
  const hooks = computer?.hooks ?? []
  const loose = hooks.filter((k) => !app.harnesses.some((h) => h.id === k.harness))
  const here = app.harnesses.filter((h) => h.installed || hooks.some((k) => k.harness === h.id))
  const away = app.harnesses.filter((h) => !here.includes(h))
  const marks = new Map<string, Harness>([...here.map((h) => h.id), ...loose.map((k) => k.harness)].map((id) => [`harness:${id}`, id]))
  const change = (hook: Hook) => {
    if (busy.has(hook.harness)) return
    const on = hook.state !== "installed"
    setBusy((was) => new Set(was).add(hook.harness))
    void actions
      .setHooks(hook.harness, on)
      .catch((err: unknown) =>
        failedToast(t("settings.agents.hooks.failed", { harness: hook.label }), err, {
          other: t("settings.agents.hooks.failed.next", { command: `kiwi hooks ${on ? "install" : "uninstall"} ${hook.harness}` }),
        })
      )
      .finally(() =>
        setBusy((was) => {
          const next = new Set(was)
          next.delete(hook.harness)
          return next
        })
      )
  }
  const run = () => {
    setCheck("running")
    actions.checkComputer().then(
      (f) => setCheck(f ?? "failed"),
      () => setCheck("failed")
    )
  }
  const a = acts()
  const kiwi = kiwiState(computer)
  const md = join([
    `# ${esc(t("settings.settings.agents"))}`,
    field("personalities"),
    `## ${esc(t("settings.agents.harnesses"))}${kiwi ? ` · ${esc(kiwi)}` : ""}`,
    [
      ...here.map((h) =>
        hookRow(
          h.id,
          h.label,
          h.version,
          h.path,
          hooks.find((k) => k.harness === h.id),
          a,
          change
        )
      ),
      ...loose.map((k) => hookRow(k.harness, k.label, undefined, undefined, k, a, change)),
    ].join("\n"),
    away.length ? fine(say("settings.agents.not.installed", { names: away.map((h) => h.label).join(", ") })) : "",
    computer ? `## ${esc(t("settings.agents.this.computer"))}` : "",
    computer
      ? [
          checkRow(check, a, run),
          computer.contextLine === null
            ? ""
            : toggle(
                computer.contextLine,
                a.act(t("settings.agents.checkpoint"), () => actions.setContextLine(!computer.contextLine)),
                say("settings.agents.checkpoint.hint")
              ),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
  ])
  const mark = (name: string): ReactNode | undefined => {
    const harness = marks.get(name)
    return harness ? <HarnessMark harness={harness} /> : undefined
  }
  return <Sheet md={md} seal={a.seal} field={(name) => (name === "personalities" ? <Personalities /> : undefined)} mark={mark} />
}
