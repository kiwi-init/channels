import { useEffect, useState } from "react"

import { cx, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Computer } from "~/model"
import { useApp } from "~/nav"
import { Confirm } from "~/settings/controls"
import { Page } from "~/settings/sections"

type Kind = "computer" | "phone"

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

function phoneWarning(phone: Computer): string {
  const held = phone.holds?.length ? `your person key and the keys of ${phone.holds.join(", ")}` : "your person key and the keys of the channels you had when you linked it"
  return `It holds ${held}, so it can act as you there. Forgetting it removes it from this list; to sign it out, unlink it on the phone. If it's lost or stolen, there's no way yet to cut it off from here.`
}

export function ComputersSection() {
  const { app, toast } = useApp()
  const [pairing, setPairing] = useState<{ kind: Kind; code: string } | null>(null)
  const [forget, setForget] = useState<Computer | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const account = app.account
  if (!account) return null
  const computers = [...account.computers].sort((a, b) => Number(b.thisOne) - Number(a.thisOne) || Number(b.online) - Number(a.online))

  const begin = (kind: Kind) => {
    void app.actions.pairBegin(kind).then(
      (code) => setPairing({ kind, code }),
      () => toast("Could not start pairing. Try again.")
    )
  }

  return (
    <Page title="Computers and phones" lede="Everywhere you are signed in. Agents run on computers; phones read and answer.">
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
                {c.online ? "online" : `offline · ${ago(c.lastSeen)}`}
                {!isPhone(c) && <span> · {c.agents === 0 ? "no agents" : c.agents === 1 ? "1 agent" : `${c.agents} agents`}</span>}
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

      {account.pairAsk ? (
        <div className="set-pair" role="region" aria-label="Confirm pairing">
          <p className="set-pair-what">
            {account.pairAsk.label}
            {account.pairAsk.os ? ` (${account.pairAsk.os})` : ""} asks to pair
          </p>
          {account.pairAsk.digits && (
            <>
              <p className="set-pair-how">Check that it shows the same code:</p>
              <div className="set-pair-code">
                <code>{account.pairAsk.digits}</code>
              </div>
            </>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn is-primary is-small"
              onClick={() => {
                app.actions.answerPair(true)
                setPairing(null)
              }}
            >
              {account.pairAsk.digits ? "It matches: pair" : "Pair"}
            </button>
            <button
              type="button"
              className="btn is-small"
              onClick={() => {
                app.actions.answerPair(false)
                setPairing(null)
              }}
            >
              Not this one
            </button>
          </div>
        </div>
      ) : pairing ? (
        <div className="set-pair" role="region" aria-label={pairing.kind === "phone" ? "Link a phone" : "Add a computer"}>
          <p className="set-pair-what">{pairing.kind === "phone" ? "Link a phone" : "Add a computer"}</p>
          <div className="set-pair-code">
            <code>{pairing.code}</code>
            <IconButton
              icon="copy"
              label="Copy the code"
              onClick={() => {
                void navigator.clipboard.writeText(pairing.code).then(
                  () => toast("Code copied"),
                  () => toast("Could not copy")
                )
              }}
            />
          </div>
          <p className="set-pair-how">
            {pairing.kind === "phone" ? (
              "Open Channels on your phone and type this code."
            ) : (
              <>
                On the other computer run <code>kiwi pair</code> and type this code.
              </>
            )}
          </p>
          <div className="set-pair-foot">
            <span className="set-pair-wait">
              <span className="set-pip is-waiting" aria-hidden="true" />
              Waiting for the {pairing.kind}…
            </span>
            <button
              type="button"
              className="btn is-quiet is-small"
              onClick={() => {
                app.actions.cancelPair()
                setPairing(null)
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions set-device-actions">
          <button type="button" className="btn" onClick={() => begin("computer")}>
            <Icon name="computer" size={14} />
            Add a computer
          </button>
          <button type="button" className="btn" onClick={() => begin("phone")}>
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
