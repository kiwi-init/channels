import { useState } from "react"

import { cx, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Computer } from "~/model"
import { useApp } from "~/nav"
import { Confirm } from "~/settings/controls"
import { Page } from "~/settings/sections"

type Kind = "computer" | "phone"

const isPhone = (c: Computer): boolean => c.os === "iphone" || c.os === "android"

export function ComputersSection() {
  const { app, toast } = useApp()
  const [pairing, setPairing] = useState<{ kind: Kind; code: string } | null>(null)
  const [forget, setForget] = useState<Computer | null>(null)
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
              <button type="button" className="btn is-quiet is-small set-forget" onClick={() => setForget(c)}>
                Forget
              </button>
            )}
          </li>
        ))}
      </ul>

      {pairing ? (
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
            <button type="button" className="btn is-quiet is-small" onClick={() => setPairing(null)}>
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
        sub="It is signed out and its agents stop. Pair it again to bring it back."
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
