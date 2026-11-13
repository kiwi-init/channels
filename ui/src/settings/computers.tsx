import "~/i18n/en/settings"

import { ComputerIcon, SmartPhone01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useId, useState } from "react"

import { t } from "~/i18n/i18n"
import { cx, IconButton } from "~/kit/bits"
import { Details, failure, type Failure } from "~/kit/failed"
import { GlyphIcon, Icon } from "~/kit/icons"
import { ago, useNow } from "~/kit/time"
import type { Account, Computer, Device, LaunchedAgent } from "~/model"
import { useApp } from "~/nav"
import { Confirm } from "~/settings/controls"
import { Page } from "~/settings/sections"
import { copyText } from "~/kit/toasts"

type Kind = "computer" | "phone"

const SHOT = new URLSearchParams(location.search).get("shot")
const PRESET: Kind | null = SHOT === "settings-link-phone" || SHOT === "settings-link-phone-stuck" ? "phone" : SHOT === "settings-add-computer" ? "computer" : null

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

function DeviceMeta({ d, runner }: { d: Device; runner: Device | null }) {
  const now = useNow(60_000)
  const soonest = [d, runner].flatMap((x) => (x && due(x.until, now) ? [x.until] : [])).sort((a, b) => a - b)[0]
  const about = [d.os, d.as === "computer" && t("settings.computers.agents.only"), runner && t("settings.computers.runs.agents")].filter(Boolean).join(" · ")
  return (
    <span className="set-device-status">
      {about}
      {soonest !== undefined && (
        <>
          {about && " · "}
          <span className={soonest <= now ? "tone-alert" : "tone-decide"}>{expiry(soonest, now)}</span>
        </>
      )}
    </span>
  )
}

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function DeviceNotices({ account }: { account: Account }) {
  return (
    <>
      {account.forgotHere && (
        <p className="set-fine set-warning" role="note">
          {t("settings.computers.forgot.here", { who: account.forgotHere.by })}
        </p>
      )}
      {account.forgotten?.map((f) => (
        <p key={`${f.label}:${f.at}`} className="set-fine set-warning" role="note">
          {t("settings.computers.forgot", { who: f.by, device: f.label, day: day(f.at) })}
        </p>
      ))}
    </>
  )
}

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

function SignedDevices({ devices }: { devices: Device[] }) {
  const { app } = useApp()
  const rows = devices.filter((d) => !(d.app && devices.some((x) => x.id === d.app)))
  const runnerOf = (d: Device): Device | null => devices.find((x) => x.as === "computer" && x.app === d.id) ?? null
  const [forget, setForget] = useState<{ row: Device; runner: Device | null } | null>(() => {
    const row =
      SHOT === "settings-forget-agents" ? devices.find((d) => d.as === "desktop" && !d.thisOne && runnerOf(d)) : SHOT === "settings-forget-plain" ? devices.find((d) => d.as === "phone") : undefined
    return row ? { row, runner: runnerOf(row) } : null
  })
  return (
    <section className="set-group" aria-label={t("settings.computers.signed.in")}>
      <div className="heading">
        <h3>{t("settings.computers.signed.in")}</h3>
      </div>
      {app.account && <DeviceNotices account={app.account} />}
      <ul className="set-devices">
        {rows.map((d) => {
          const runner = runnerOf(d)
          const renew = [d, runner].flatMap((x) => (x && due(x.until) ? [x.id] : []))
          return (
            <li key={d.id} className="set-device">
              <span className="set-device-icon" aria-hidden="true">
                <GlyphIcon glyph={d.as === "phone" ? SmartPhone01Icon : ComputerIcon} />
              </span>
              <span className="set-device-text">
                <span className="set-device-name">
                  {d.label}
                  {d.thisOne && <span className="set-tag">{t("settings.computers.this.app")}</span>}
                </span>
                <span className="set-device-meta">
                  <DeviceMeta d={d} runner={runner} />
                </span>
              </span>
              <span className="set-device-actions-inline">
                {renew.length > 0 && (
                  <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.renewDevice(...renew)}>
                    {t("settings.computers.renew")}
                  </button>
                )}
                {!d.thisOne && (
                  <button type="button" className="btn is-quiet is-small set-forget" onClick={() => setForget({ row: d, runner })}>
                    {t("settings.computers.forget")}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <ForgetDevice forget={forget} onClose={() => setForget(null)} />
    </section>
  )
}

function phoneWarning(phone: Computer): string {
  return phone.holds?.length ? t("settings.computers.phone.holds", { channels: phone.holds.join(", ") }) : t("settings.computers.phone.holds.linked")
}

function PairLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="set-pair-line">
      <code>{text}</code>
      <IconButton
        icon="copy"
        label={label}
        onClick={() => {
          copyText(text)
        }}
      />
    </div>
  )
}

export function ComputersSection() {
  const { app } = useApp()
  const [linking, setLinking] = useState<Kind | null>(PRESET)
  const [forget, setForget] = useState<Computer | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const pairedId = useId()
  const asked = app.account?.enrollAsk?.id
  const [seen, setSeen] = useState(asked)
  if (asked !== seen) {
    setSeen(asked)
    if (asked) setLinking(null)
  }
  const account = app.account
  if (!account) return null
  const computers = [...account.computers].sort((a, b) => Number(b.thisOne) - Number(a.thisOne) || Number(b.online) - Number(a.online))

  return (
    <Page title={t("settings.settings.computers")}>
      {!account.devices?.length && account.forgotHere && <DeviceNotices account={account} />}
      {account.devices && account.devices.length > 0 && (
        <>
          <SignedDevices devices={account.devices} />
          <div className="set-group">
            <div className="heading">
              <h3 id={pairedId}>{t("settings.computers.paired")}</h3>
            </div>
          </div>
        </>
      )}
      <ul className="set-devices" aria-labelledby={account.devices?.length ? pairedId : undefined}>
        {computers.map((c) => (
          <li key={c.id} className="set-device">
            <span className="set-device-icon" aria-hidden="true">
              <GlyphIcon glyph={isPhone(c) ? SmartPhone01Icon : ComputerIcon} />
            </span>
            <span className="set-device-text">
              <span className="set-device-name">
                {c.label}
                {c.thisOne && <span className="set-tag">{t("settings.computers.this.computer")}</span>}
              </span>
              <span className="set-device-meta">
                <span className={cx("set-pip", c.online && "is-online")} aria-hidden="true" />
                <span className="set-device-status">
                  {c.online ? t("settings.computers.online") : t("settings.computers.offline", { ago: ago(c.lastSeen) })}
                  {!isPhone(c) && ` · ${c.agents === 0 ? t("settings.computers.no.agents") : t("settings.computers.agents", { count: c.agents })}`}
                </span>
              </span>
            </span>
            {!c.thisOne && (
              <span className="set-device-actions-inline">
                {!isPhone(c) && (
                  <button type="button" className="btn is-quiet is-small" aria-expanded={shown === c.id} onClick={() => setShown(shown === c.id ? null : c.id)}>
                    {t("settings.computers.its.settings")}
                  </button>
                )}
                <button type="button" className="btn is-quiet is-small set-forget" onClick={() => setForget(c)}>
                  {t("settings.computers.forget")}
                </button>
              </span>
            )}
            {shown === c.id && <TheirSettings computer={c} />}
          </li>
        ))}
      </ul>

      {linking ? (
        <div className="set-pair" role="region" aria-label={linking === "phone" ? t("settings.computers.link.phone") : t("settings.computers.add.computer")}>
          <p className="set-pair-what">{linking === "phone" ? t("settings.computers.link.phone") : t("settings.computers.add.computer")}</p>
          {linking === "phone" ? (
            <p className="set-pair-how">{t("settings.computers.how.phone")}</p>
          ) : (
            <>
              <p className="set-pair-how">{t("settings.computers.how.computer")}</p>
              <PairLine text="kiwi login" label={t("settings.computers.copy.command")} />
            </>
          )}
          <div className="set-pair-foot">
            {account.enrollError ? (
              <span className="set-pair-wait is-stuck" role="alert">
                {t(linking === "phone" ? "settings.computers.stuck.phone" : "settings.computers.stuck.computer", { error: account.enrollError.replace(/[.\s]+$/, "") })}
              </span>
            ) : (
              <span className="set-pair-wait">
                <span className="set-pip is-waiting" aria-hidden="true" />
                {t(linking === "phone" ? "settings.computers.waiting.phone" : "settings.computers.waiting.computer")}
              </span>
            )}
            <button type="button" className="btn is-quiet is-small" onClick={() => setLinking(null)}>
              {t("settings.controls.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="actions set-device-actions">
          <button type="button" className="btn" onClick={() => setLinking("computer")}>
            <GlyphIcon glyph={ComputerIcon} size={14} />
            {t("settings.computers.add.computer")}
          </button>
          <button type="button" className="btn" onClick={() => setLinking("phone")}>
            <GlyphIcon glyph={SmartPhone01Icon} size={14} />
            {t("settings.computers.link.phone")}
          </button>
        </div>
      )}

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
    </Page>
  )
}
