import { useEffect, useState } from "react"

import { cx, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Account, Computer, Device, LaunchedAgent } from "~/model"
import { useApp } from "~/nav"
import { Confirm } from "~/settings/controls"
import { RecoveryKey } from "~/settings/recovery"
import { Page } from "~/settings/sections"
import { copyText } from "~/kit/toasts"

type Kind = "computer" | "phone"

const SHOT = new URLSearchParams(location.search).get("shot")
const PRESET: Kind | null = SHOT === "settings-link-phone" || SHOT === "settings-link-phone-stuck" ? "phone" : SHOT === "settings-add-computer" ? "computer" : null

const isPhone = (c: Computer): boolean => c.os === "iphone" || c.os === "android"

function TheirSettings({ computer }: { computer: Computer }) {
  const { app } = useApp()
  const [got, setGot] = useState<{ ok: true; lines: [string, string[]][] } | { ok: false; why: string } | null>(null)
  const [round, setRound] = useState(0)
  const { computerSettings } = app.actions
  useEffect(() => {
    let live = true
    computerSettings(computer.id).then(
      (lines) => live && setGot({ ok: true, lines }),
      (err: unknown) => live && setGot({ ok: false, why: err instanceof Error ? err.message : String(err) })
    )
    return () => {
      live = false
    }
  }, [computerSettings, computer.id, round])
  const again = () => {
    setGot(null)
    setRound((r) => r + 1)
  }
  return (
    <div className="set-device-settings">
      {got === null ? (
        <p className="set-device-meta">Asking {computer.label}…</p>
      ) : !got.ok ? (
        <p className="set-device-meta">
          {got.why}
          <button type="button" className="btn is-quiet is-small" onClick={again}>
            Try again
          </button>
        </p>
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
          <p className="set-device-meta">Read only. Change these on {computer.label}.</p>
        </>
      )}
    </div>
  )
}

const DAY = 86_400_000
const RENEW_WITHIN = 14 * DAY

const KIND: Record<Device["as"], string> = { desktop: "computer", phone: "phone", computer: "computer for agents" }

function expiry(until: number, now = Date.now()): string {
  if (until <= now) return "expired"
  const days = Math.ceil((until - now) / DAY)
  return days === 1 ? "expires tomorrow" : `expires in ${days} days`
}

const due = (until: number, now = Date.now()): boolean => until - now < RENEW_WITHIN

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function DeviceNotices({ account }: { account: Account }) {
  return (
    <>
      {account.forgotHere && (
        <p className="set-fine set-warning" role="note">
          {account.forgotHere.by} forgot this app. It keeps your person key and its channels, but it can't approve or change your devices any more.
        </p>
      )}
      {account.forgotten?.map((f) => (
        <p key={`${f.label}:${f.at}`} className="set-fine set-warning" role="note">
          {f.by} forgot {f.label} on {day(f.at)}, and you had {f.label} longer. If that wasn't you, forget {f.by}.
        </p>
      ))}
    </>
  )
}

const FORGET_ONE = "It can't sign in as you again. Channels you own drop it now; other channels drop it when their owner's app is next open."
const FORGET_RAN = "It can't sign in as you again. It started these agents of yours:"

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
      title={`Forget ${forget?.row.label ?? ""}?`}
      sub={agents?.length ? FORGET_RAN : FORGET_ONE}
      action="Forget"
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
                <span className="set-forget-in"> in {title(code)}</span>
              </li>
            ))}
          </ul>
          <div className="set-forget-choices" role="radiogroup" aria-label="Its agents">
            <ForgetChoice
              on={!keep}
              pick={() => setKeep(false)}
              label="This computer is lost: remove its agents too"
              about="They leave every channel. Channels you own drop them now, others when their owner's app is next open."
            />
            <ForgetChoice on={keep} pick={() => setKeep(true)} label="I replaced the app here: keep them" about="They stay in every channel, now tied to this computer." />
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
    <section className="set-group" aria-label="Signed in as you">
      <div className="heading">
        <h3>Signed in as you</h3>
      </div>
      <p className="set-group-hint">Each one has its own key. Forget one and it can't sign in as you again.</p>
      {app.account && <DeviceNotices account={app.account} />}
      <ul className="set-devices">
        {rows.map((d) => {
          const runner = runnerOf(d)
          const renew = [d, runner].flatMap((x) => (x && due(x.until) ? [x.id] : []))
          return (
            <li key={d.id} className="set-device">
              <span className="set-device-icon" aria-hidden="true">
                <Icon name={d.as === "phone" ? "phone" : "computer"} />
              </span>
              <span className="set-device-text">
                <span className="set-device-name">
                  {d.label}
                  {d.thisOne && <span className="set-tag">this app</span>}
                </span>
                <span className="set-device-meta">
                  <span className="set-device-status">
                    {KIND[d.as]}
                    {d.os ? ` · ${d.os}` : ""} · {expiry(d.until)}
                  </span>
                </span>
                {runner && (
                  <span className="set-device-meta">
                    <span className="set-device-status">runs your agents · {expiry(runner.until)}</span>
                  </span>
                )}
              </span>
              <span className="set-device-actions-inline">
                {renew.length > 0 && (
                  <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.renewDevice(...renew)}>
                    Renew
                  </button>
                )}
                {!d.thisOne && (
                  <button type="button" className="btn is-quiet is-small set-forget" onClick={() => setForget({ row: d, runner })}>
                    Forget
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
  const held = phone.holds?.length ? `your person key and the keys of ${phone.holds.join(", ")}` : "your person key and the keys of the channels you had when you linked it"
  return `It holds ${held}, so it can act as you there. Forgetting it removes it from this list; to sign it out, unlink it on the phone. If it's lost or stolen, there's no way yet to cut it off from here.`
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
    <Page title="Computers and phones" lede="Agents run on computers; phones read and answer.">
      {!account.devices?.length && account.forgotHere && <DeviceNotices account={account} />}
      {account.devices && account.devices.length > 0 && (
        <>
          <SignedDevices devices={account.devices} />
          {account.recovery && <RecoveryKey recovery={account.recovery} />}
          <section className="set-group" aria-label="Paired with a code">
            <div className="heading">
              <h3>Paired with a code</h3>
            </div>
          </section>
        </>
      )}
      <ul className="set-devices">
        {computers.map((c) => (
          <li key={c.id} className="set-device">
            <span className="set-device-icon" aria-hidden="true">
              <Icon name={isPhone(c) ? "phone" : "computer"} />
            </span>
            <span className="set-device-text">
              <span className="set-device-name">
                {c.label}
                {c.thisOne && <span className="set-tag">this computer</span>}
              </span>
              <span className="set-device-meta">
                <span className={cx("set-pip", c.online && "is-online")} aria-hidden="true" />
                <span className="set-device-status">
                  {c.online ? "online" : `offline · ${ago(c.lastSeen)}`}
                  {!isPhone(c) && ` · ${c.agents === 0 ? "no agents" : c.agents === 1 ? "1 agent" : `${c.agents} agents`}`}
                </span>
              </span>
            </span>
            {!c.thisOne && (
              <span className="set-device-actions-inline">
                {!isPhone(c) && (
                  <button type="button" className="btn is-quiet is-small" aria-expanded={shown === c.id} onClick={() => setShown(shown === c.id ? null : c.id)}>
                    Its settings
                  </button>
                )}
                <button type="button" className="btn is-quiet is-small set-forget" onClick={() => setForget(c)}>
                  Forget
                </button>
              </span>
            )}
            {shown === c.id && <TheirSettings computer={c} />}
          </li>
        ))}
      </ul>

      {linking ? (
        <div className="set-pair" role="region" aria-label={linking === "phone" ? "Link a phone" : "Add a computer"}>
          <p className="set-pair-what">{linking === "phone" ? "Link a phone" : "Add a computer"}</p>
          {linking === "phone" ? (
            <p className="set-pair-how">On your phone, open Channels and tap Sign In. It shows 6 digits: type them here when this app asks.</p>
          ) : (
            <>
              <p className="set-pair-how">On the other computer, run this in a terminal and sign in. It shows 6 digits: type them here when this app asks.</p>
              <PairLine text="kiwi login" label="Copy the command" />
            </>
          )}
          <div className="set-pair-foot">
            {account.enrollError ? (
              <span className="set-pair-wait is-stuck" role="alert">
                Can't see the {linking}: {account.enrollError.replace(/[.\s]+$/, "")}.
              </span>
            ) : (
              <span className="set-pair-wait">
                <span className="set-pip is-waiting" aria-hidden="true" />
                Waiting for the {linking}…
              </span>
            )}
            <button type="button" className="btn is-quiet is-small" onClick={() => setLinking(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions set-device-actions">
          <button type="button" className="btn" onClick={() => setLinking("computer")}>
            <Icon name="computer" size={14} />
            Add a computer
          </button>
          <button type="button" className="btn" onClick={() => setLinking("phone")}>
            <Icon name="phone" size={14} />
            Link a phone
          </button>
        </div>
      )}

      <Confirm
        open={!!forget}
        title={`Forget ${forget?.label ?? ""}?`}
        sub={forget && isPhone(forget) ? phoneWarning(forget) : "It is signed out and its agents stop. Pair it again to bring it back."}
        action="Forget"
        onClose={() => setForget(null)}
        onConfirm={() => {
          if (forget) app.actions.forgetComputer(forget.id)
          setForget(null)
        }}
      />
    </Page>
  )
}
