import "~/i18n/en/settings"

import { useState } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { cx } from "~/kit/bits"
import { failedToast } from "~/kit/failed"
import { Toggle } from "~/kit/form"
import { Icon } from "~/kit/icons"
import { LOGOS } from "~/kit/logos"
import { RoleFace } from "~/kit/role-face"
import type { Finding, Harness, ThisComputer } from "~/model"
import { useApp } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { Personalities } from "~/settings/personalities"
import { Page } from "~/settings/sections"

type Hook = ThisComputer["hooks"][number]

const REMOVE = { action: "settings.agents.hooks.remove", label: "settings.agents.hooks.remove.for" } as const
const UPDATE = { action: "settings.agents.hooks.update", label: "settings.agents.hooks.update.for" } as const
const ADD = { action: "settings.agents.hooks.add", label: "settings.agents.hooks.add.for" } as const

const HOOK_SAYS: Record<Hook["state"], { state: Key; action: Key; label: Key; tone?: string; why?: Key }> = {
  installed: { state: "settings.agents.hooks.on", ...REMOVE },
  partial: { state: "settings.agents.hooks.old", ...UPDATE, tone: "tone-decide", why: "settings.agents.hooks.why.partial" },
  outdated: { state: "settings.agents.hooks.old", ...UPDATE, tone: "tone-decide", why: "settings.agents.hooks.why.outdated" },
  missing: { state: "settings.agents.hooks.none", ...ADD },
  off: { state: "settings.agents.hooks.none", ...ADD, why: "settings.agents.hooks.why.off" },
}

function HookState({ hook }: { hook: Hook }) {
  const { app } = useApp()
  const [busy, setBusy] = useState(false)
  const says = HOOK_SAYS[hook.state]
  const change = () => {
    const on = hook.state !== "installed"
    setBusy(true)
    void app.actions
      .setHooks(hook.harness, on)
      .catch((err: unknown) =>
        failedToast(t("settings.agents.hooks.failed", { harness: hook.label }), err, {
          other: t("settings.agents.hooks.failed.next", { command: `kiwi hooks ${on ? "install" : "uninstall"} ${hook.harness}` }),
        })
      )
      .finally(() => setBusy(false))
  }
  return (
    <>
      <span className={cx("set-harness-state", says.tone)} title={says.why && t(says.why)}>
        {t(says.state)}
      </span>
      <button type="button" className="btn is-quiet is-small" title={t("settings.agents.hooks.do")} aria-label={t(says.label, { harness: hook.label })} disabled={busy} onClick={change}>
        {t(says.action)}
      </button>
    </>
  )
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

function HarnessRow({ harness, label, version, path, hook }: { harness: Harness; label: string; version?: string | undefined; path?: string | undefined; hook: Hook | undefined }) {
  return (
    <div className="set-row set-harness">
      <HarnessMark harness={harness} />
      <span className="set-row-text">
        <span className="set-row-label">
          {label}
          {version && <span className="set-harness-version">{version}</span>}
        </span>
        {path && (
          <span className="set-row-hint set-harness-path" title={path}>
            {path}
          </span>
        )}
      </span>
      {hook && (
        <span className="set-row-ctl">
          <HookState hook={hook} />
        </span>
      )}
    </div>
  )
}

function KiwiState({ computer }: { computer: ThisComputer | null }) {
  if (!computer) return null
  if (!computer.kiwi.running) return <span className="set-kiwi tone-decide">{t("settings.agents.kiwi.stopped")}</span>
  return <span className="set-kiwi">{computer.kiwi.version ? t("settings.agents.kiwi.running.version", { version: computer.kiwi.version }) : t("settings.agents.kiwi.running")}</span>
}

function CheckComputer() {
  const { app } = useApp()
  const [state, setState] = useState<"idle" | "running" | "failed" | Finding[]>("idle")
  const run = () => {
    setState("running")
    app.actions.checkComputer().then(
      (f) => setState(f ?? "failed"),
      () => setState("failed")
    )
  }
  const problems = Array.isArray(state) ? state.filter((f) => !f.ok).length : 0
  return (
    <>
      <Row
        label={t("settings.agents.check")}
        hint={Array.isArray(state) ? (problems ? t("settings.agents.check.problems", { count: problems }) : t("settings.agents.check.fine")) : t("settings.agents.check.hint")}
      >
        <button type="button" className="btn is-small" disabled={state === "running"} onClick={run}>
          {state === "running" ? t("settings.sections.checking") : Array.isArray(state) ? t("settings.agents.check.again") : t("settings.agents.check.run")}
        </button>
      </Row>
      {Array.isArray(state) && (
        <ul className="set-findings">
          {state.map((f) => (
            <FindingRow key={f.what} f={f} />
          ))}
        </ul>
      )}
      {state === "failed" && <p className="set-row-hint set-findings-none">{tr("settings.agents.check.failed", { command: <code>{"kiwi doctor"}</code> })}</p>}
    </>
  )
}

function FindingRow({ f }: { f: Finding }) {
  if (!f.ok)
    return (
      <li className="set-finding is-bad">
        <span className="set-finding-dot" aria-hidden="true" />
        <span className="set-finding-text">
          <span>{f.what}</span>
          <span className="set-row-hint">{f.how}</span>
        </span>
      </li>
    )
  const [, label, value] = /^(\S+)\s{2,}(.*)$/.exec(f.what) ?? [null, null, f.what]
  return (
    <li className="set-finding">
      <Icon name="check" size={14} />
      {label && <span className="set-finding-label">{label}</span>}
      <span className="set-finding-text">{value}</span>
    </li>
  )
}

export function AgentsSection() {
  const { app } = useApp()
  const { computer, actions } = app
  const hooks = computer?.hooks ?? []
  const loose = hooks.filter((k) => !app.harnesses.some((h) => h.id === k.harness))
  const here = app.harnesses.filter((h) => h.installed || hooks.some((k) => k.harness === h.id))
  const away = app.harnesses.filter((h) => !here.includes(h))
  return (
    <Page title={t("settings.settings.agents")}>
      <Personalities />

      <Group title={t("settings.agents.harnesses")} aside={<KiwiState computer={computer} />}>
        {here.map((h) => (
          <HarnessRow key={h.id} harness={h.id} label={h.label} version={h.version} path={h.path} hook={hooks.find((k) => k.harness === h.id)} />
        ))}
        {loose.map((k) => (
          <HarnessRow key={k.harness} harness={k.harness} label={k.label} hook={k} />
        ))}
        {away.length > 0 && <p className="set-harness-away">{t("settings.agents.not.installed", { names: away.map((h) => h.label).join(", ") })}</p>}
      </Group>

      {computer && (
        <Group title={t("settings.agents.this.computer")}>
          <CheckComputer />
          {computer.contextLine !== null && (
            <Row label={t("settings.agents.checkpoint")} hint={t("settings.agents.checkpoint.hint")}>
              <Toggle label={t("settings.agents.checkpoint")} on={computer.contextLine} onChange={actions.setContextLine} />
            </Row>
          )}
        </Group>
      )}
    </Page>
  )
}
