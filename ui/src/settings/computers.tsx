import "~/i18n/en/settings"

import { useEffect, useState, type ReactNode } from "react"

import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Details, failure, type Failure } from "~/kit/failed"
import { Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import { copyText } from "~/kit/toasts"
import type { Account, Computer, Device, LaunchedAgent } from "~/model"
import { useApp } from "~/nav"
import { Confirm } from "~/settings/controls"
import { acts, card, code, esc, field, join, note, row, say, Sheet, words, type Acts } from "~/settings/sheet"

type Kind = "computer" | "phone"

const SHOT = new URLSearchParams(location.search).get("shot")
const PRESET: Kind | null = SHOT === "settings-link-phone" || SHOT === "settings-link-phone-stuck" ? "phone" : SHOT === "settings-add-computer" ? "computer" : null

const LOGIN = "kiwi login"

const isPhone = (c: Computer): boolean => c.os === "iphone" || c.os === "android"

function theirFailure(device: string, err: unknown): Failure {
  const why = err instanceof Error && "why" in err ? err.why : null
  const said = why === "no-answer" ? t("settings.computers.no.answer") : why === "not-registered" ? t("settings.computers.not.registered") : why === "busy" ? t("kit.failed.busy") : null
  return failure(t("settings.computers.settings.failed", { device }), err, said ? { other: said } : {})
}

function TheirSettings({ computer }: { computer: Computer }) {
  const { app } = useApp()
  const [got, setGot] = useState<{ ok: true; lines: [string, string[]][] } | { ok: false; failed: Failure } | null>(null)
  const [round, setRound] = useState(0)
  const { computerSettings } = app.actions
  useEffect(() => {
    let live = true
    computerSettings(computer.id).then(
      (lines) => live && setGot({ ok: true, lines }),
      (err: unknown) => live && setGot({ ok: false, failed: theirFailure(computer.label, err) })
    )
    return () => {
      live = false
    }
  }, [computerSettings, computer.id, computer.label, round])
  const again = () => {
    setGot(null)
    setRound((r) => r + 1)
  }
  return (
    <div className="set-device-settings">
      {got === null ? (
        <p className="set-device-meta">{t("settings.computers.asking", { device: computer.label })}</p>
      ) : !got.ok ? (
        <div className="failed" role="alert">
          <p className="set-device-meta">
            <span className="tone-alert">{got.failed.said}</span>
            <button type="button" className="btn is-quiet is-small" onClick={again}>
              {t("settings.computers.try.again")}
            </button>
          </p>
          {got.failed.raw && <Details raw={got.failed.raw} />}
        </div>
      ) : (
        <>
          <dl className="set-their">
            {got.lines.map(([term, lines]) => (
              <div key={term} className="set-their-row">
                <dt>{term}</dt>
                <dd>
                  {lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="set-device-meta">{t("settings.computers.read.only", { device: computer.label })}</p>
        </>
      )}
    </div>
  )
}

const DAY = 86_400_000
const RENEW_WITHIN = 14 * DAY

function expiry(until: number, now = Date.now()): string {
  if (until <= now) return t("settings.computers.expired")
  const days = Math.ceil((until - now) / DAY)
  return days === 1 ? t("settings.computers.expires.tomorrow") : t("settings.computers.expires.in", { count: days })
}

const due = (until: number, now = Date.now()): boolean => until - now < RENEW_WITHIN

function ForgetDevice({ forget, onClose }: { forget: { row: Device; runner: Device | null } | null; onClose: () => void }) {
  const { app } = useApp()
  const [keep, setKeep] = useState(false)
  const [got, setGot] = useState<{ key: string; agents: LaunchedAgent[] } | null>(null)
  const ids = forget ? [...(forget.runner ? [forget.runner.id] : []), forget.row.id] : []
  const key = ids.join(" ")
  const agents = got?.key === key ? got.agents : null
  const { launchedFrom } = app.actions
  useEffect(() => {
    let live = true
    if (key)
      launchedFrom(key.split(" ")).then(
        (found) => live && setGot({ key, agents: found }),
        () => live && setGot({ key, agents: [] })
      )
    return () => {
      live = false
    }
  }, [key, launchedFrom])
  const title = (code: string): string => app.channels.find((c) => c.code === code)?.title ?? code
  const close = () => {
    setKeep(false)
    onClose()
  }
  return (
    <Confirm
      open={!!forget}
      title={t("settings.computers.forget.title", { device: forget?.row.label ?? "" })}
      sub={agents?.length ? t("settings.computers.forget.ran") : t("settings.computers.forget.one")}
      action={t("settings.computers.forget")}
      ready={agents !== null}
      onClose={close}
      onConfirm={() => {
        app.actions.forgetDevice(ids, keep && agents ? agents.map(({ code, pk, from }) => ({ code, pk, from })) : undefined)
        close()
      }}
    >
      {agents && agents.length > 0 && (
        <>
          <ul className="set-forget-agents">
            {[...new Set(agents.map((a) => a.code))].map((code) => (
              <li key={code}>
                <span className="set-forget-names">
                  {agents
                    .filter((a) => a.code === code)
                    .map((a) => a.name)
                    .join(", ")}
                </span>
                <span className="set-forget-in"> {t("settings.computers.forget.in", { channel: title(code) })}</span>
              </li>
            ))}
          </ul>
          <div className="set-forget-choices" role="radiogroup" aria-label={t("settings.computers.forget.agents")}>
            <ForgetChoice on={!keep} pick={() => setKeep(false)} label={t("settings.computers.forget.lost")} about={t("settings.computers.forget.lost.about")} />
            <ForgetChoice on={keep} pick={() => setKeep(true)} label={t("settings.computers.forget.keep")} about={t("settings.computers.forget.keep.about")} />
          </div>
        </>
      )}
    </Confirm>
  )
}

function ForgetChoice({ on, pick, label, about }: { on: boolean; pick: () => void; label: string; about: string }) {
  return (
    <label className={cx("set-forget-choice", on && "is-on")}>
      <input type="radio" className="sr" name="forget-agents" checked={on} onChange={pick} />
      <span className="set-forget-text">
        <span className="set-forget-label">{label}</span>
        <span className="set-forget-about">{about}</span>
      </span>
      <span className="set-forget-tick">{on && <Icon name="check" size={14} />}</span>
    </label>
  )
}

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function phoneWarning(phone: Computer): string {
  return phone.holds?.length ? t("settings.computers.phone.holds", { channels: phone.holds.join(", ") }) : t("settings.computers.phone.holds.linked")
}

function notices(account: Account): string {
  return join([
    account.forgotHere ? note(say("settings.computers.forgot.here", { who: account.forgotHere.by })) : "",
    ...(account.forgotten ?? []).map((f) => note(say("settings.computers.forgot", { who: f.by, device: f.label, day: day(f.at) }))),
  ])
}

type Forgetting = { row: Device; runner: Device | null }

const runnerOf = (devices: readonly Device[], d: Device): Device | null => devices.find((x) => x.as === "computer" && x.app === d.id) ?? null

function presetForget(devices: readonly Device[]): Forgetting | null {
  const row =
    SHOT === "settings-forget-agents"
      ? devices.find((d) => d.as === "desktop" && !d.thisOne && runnerOf(devices, d))
      : SHOT === "settings-forget-plain"
        ? devices.find((d) => d.as === "phone")
        : undefined
  return row ? { row, runner: runnerOf(devices, row) } : null
}

interface Hooks {
  renew: (...ids: string[]) => void
  forgetDevice: (f: Forgetting) => void
  forget: (c: Computer) => void
  toggle: (id: string) => void
  link: (kind: Kind | null) => void
}

function deviceRows(devices: readonly Device[], now: number, a: Acts, hooks: Hooks): string {
  return devices
    .filter((d) => !(d.app && devices.some((x) => x.id === d.app)))
    .map((d) => {
      const runner = runnerOf(devices, d)
      const soonest = [d, runner].flatMap((x) => (x && due(x.until, now) ? [x.until] : [])).sort((p, q) => p - q)[0]
      const about = [d.os, d.as === "computer" ? t("settings.computers.agents.only") : "", runner ? t("settings.computers.runs.agents") : ""].filter(Boolean).map(esc)
      const renew = [d, runner].flatMap((x) => (x && due(x.until, now) ? [x.id] : []))
      return row({
        mark: d.as === "phone" ? "phone" : "computer",
        label: d.label,
        tag: d.thisOne ? t("settings.computers.this.app") : undefined,
        hint: [...about, soonest === undefined ? "" : soonest <= now ? words(esc(expiry(soonest, now)), { tone: "alert" }) : `**${esc(expiry(soonest, now))}**`].filter(Boolean).join(" · "),
        line: [
          renew.length ? a.act(t("settings.computers.renew"), () => hooks.renew(...renew)) : "",
          d.thisOne ? "" : a.act(t("settings.computers.forget"), () => hooks.forgetDevice({ row: d, runner })),
        ]
          .filter(Boolean)
          .join(" "),
      })
    })
    .join("\n")
}

function computerRow(c: Computer, shown: string | null, a: Acts, hooks: Hooks): string {
  const status = [
    c.online ? t("settings.computers.online") : t("settings.computers.offline", { ago: ago(c.lastSeen) }),
    isPhone(c) ? "" : c.agents === 0 ? t("settings.computers.no.agents") : t("settings.computers.agents", { count: c.agents }),
  ]
  const acts = c.thisOne ? [] : [isPhone(c) ? "" : a.act(t("settings.computers.its.settings"), () => hooks.toggle(c.id)), a.act(t("settings.computers.forget"), () => hooks.forget(c))]
  return row({
    mark: isPhone(c) ? "phone" : "computer",
    label: c.label,
    tag: c.thisOne ? t("settings.computers.this.computer") : undefined,
    hint: `${code(c.online ? "online" : "offline")} ${status.filter(Boolean).map(esc).join(" · ")}`,
    line: acts.filter(Boolean).join(" "),
    nested: shown === c.id ? [field(`their:${c.id}`)] : [],
  })
}

function pairing(linking: Kind | null, a: Acts, hooks: Hooks): string {
  if (!linking)
    return [
      a.act(t("settings.computers.add.computer"), () => hooks.link("computer"), { mark: "computer" }),
      a.act(t("settings.computers.link.phone"), () => hooks.link("phone"), { mark: "phone" }),
    ].join(" ")
  const phone = linking === "phone"
  return card([
    `### ${esc(phone ? t("settings.computers.link.phone") : t("settings.computers.add.computer"))}`,
    say(phone ? "settings.computers.how.phone" : "settings.computers.how.computer"),
    phone ? "" : a.chip(LOGIN, () => void copyText(LOGIN), t("settings.computers.copy.command")),
    field("pair-status"),
    a.act(t("settings.controls.cancel"), () => hooks.link(null)),
  ])
}

function PairStatus({ kind, error }: { kind: Kind; error: string | undefined }) {
  if (error)
    return (
      <span className="set-pair-wait is-stuck" role="alert">
        {t(kind === "phone" ? "settings.computers.stuck.phone" : "settings.computers.stuck.computer", { error: error.replace(/[.\s]+$/, "") })}
      </span>
    )
  return (
    <span className="set-pair-wait">
      <span className="set-pip is-waiting" aria-hidden="true" />
      {t(kind === "phone" ? "settings.computers.waiting.phone" : "settings.computers.waiting.computer")}
    </span>
  )
}

export function ComputersPage() {
  const { app } = useApp()
  const now = useNow(60_000)
  const [linking, setLinking] = useState<Kind | null>(PRESET)
  const [forget, setForget] = useState<Computer | null>(null)
  const [forgetting, setForgetting] = useState<Forgetting | null>(() => presetForget(app.account?.devices ?? []))
  const [shown, setShown] = useState<string | null>(null)
  const asked = app.account?.enrollAsk?.id
  const [seen, setSeen] = useState(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) setLinking(null)
  }
  const account = app.account
  if (!account) return null
  const { actions } = app
  const devices = account.devices ?? []
  const computers = [...account.computers].sort((x, y) => Number(y.thisOne) - Number(x.thisOne) || Number(y.online) - Number(x.online))
  const a = acts()
  const hooks: Hooks = {
    renew: (...ids) => actions.renewDevice(...ids),
    forgetDevice: setForgetting,
    forget: setForget,
    toggle: (id) => setShown((was) => (was === id ? null : id)),
    link: setLinking,
  }
  const md = join([
    `# ${esc(t("settings.settings.computers"))}`,
    !devices.length && account.forgotHere ? notices(account) : "",
    devices.length ? join([`## ${esc(t("settings.computers.signed.in"))}`, notices(account), deviceRows(devices, now, a, hooks), `## ${esc(t("settings.computers.paired"))}`]) : "",
    computers.map((c) => computerRow(c, shown, a, hooks)).join("\n"),
    pairing(linking, a, hooks),
  ])
  const fields = (name: string): ReactNode | undefined => {
    if (name === "pair-status") return linking ? <PairStatus kind={linking} error={account.enrollError} /> : undefined
    const computer = name.startsWith("their:") ? computers.find((c) => c.id === name.slice("their:".length)) : undefined
    return computer ? <TheirSettings computer={computer} /> : undefined
  }
  return (
    <>
      <Sheet md={md} seal={a.seal} field={fields} />
      <ForgetDevice forget={forgetting} onClose={() => setForgetting(null)} />
      <Confirm
        open={!!forget}
        title={t("settings.computers.forget.title", { device: forget?.label ?? "" })}
        sub={forget && isPhone(forget) ? phoneWarning(forget) : t("settings.computers.signed.out")}
        action={t("settings.computers.forget")}
        onClose={() => setForget(null)}
        onConfirm={() => {
          if (forget) app.actions.forgetComputer(forget.id)
          setForget(null)
        }}
      />
    </>
  )
}
