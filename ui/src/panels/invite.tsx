import { Fragment, useEffect, useState } from "react"

import "~/styles/people-add.css"
import { cx, Heading, Toggle } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ALL_POWERS, NO_POWERS, trusted, type Channel } from "~/model"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { copyText } from "~/kit/toasts"

type Link = { code: string; link: string } | { code: string; failed: true }

function useInviteLink(code: string): { link: string | null; failed: boolean; retry: () => void } {
  const { app } = useApp()
  const [got, setGot] = useState<Link | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    app.actions
      .inviteLink(code)
      .then((link) => live && setGot({ code, link }))
      .catch(() => live && setGot({ code, failed: true }))
    return () => {
      live = false
    }
  }, [app.actions, code, attempt])
  const mine = got?.code === code ? got : null
  return {
    link: mine && "link" in mine ? mine.link : null,
    failed: !!mine && "failed" in mine,
    retry: () => {
      setGot(null)
      setAttempt((n) => n + 1)
    },
  }
}

export function CopyBox({ text, label, disabled, wrap }: { text: string | null; label: string; disabled?: boolean; wrap?: boolean }) {
  return (
    <div className={cx("codebox invite-box", disabled && "is-off", wrap && "is-wrap")}>
      <code>
        {text === null
          ? "…"
          : wrap
            ? text.split(/\s(?=--)/).map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && " "}
                  <span className="invite-part">{part}</span>
                </Fragment>
              ))
            : text}
      </code>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        title={label}
        disabled={!text || disabled}
        onClick={() => {
          if (!text) return
          copyText(text)
        }}
      >
        <Icon name="copy" />
      </button>
    </div>
  )
}

const POWERS = [
  { id: "addsAgents", label: "Can add agents", on: "Their agents join on their own from computers paired with their Kiwi app.", off: "Their agents wait for you to let them in." },
  { id: "answersDecisions", label: "Can answer decisions", on: "They answer agents' decisions in Needs you, as you do.", off: "Agents' decisions go to you and each agent's own person." },
  {
    id: "managesAgents",
    label: "Can manage agents",
    on: "They pick agents' personalities and roles, the lead included. Never people's, and never their own.",
    off: "Only you change agents' personalities and roles.",
  },
] as const

const CAN = [
  { id: "read", label: "Only read", says: "They see every room and task, and can't post." },
  { id: "write", label: "Write and work", says: "They post, take tasks and bring their own agents." },
] as const

export function InvitePanel({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const { link, failed, retry } = useInviteLink(channel.code)
  const can = channel.newMembers ?? "write"
  const powers = channel.newPowers ?? NO_POWERS
  const trust = can === "write" && trusted(powers)
  return (
    <>
      <PanelHead title="Invite people" />
      <div className="panel-body invite">
        <section className="invite-link" aria-label="Invite link">
          {failed ? (
            <div className="invite-failed">
              <span>Couldn't get a link.</span>
              <button type="button" className="btn is-small" onClick={retry}>
                Try again
              </button>
            </div>
          ) : (
            <CopyBox text={link} label="Copy link" />
          )}
          <p className="invite-note">Anyone with it can ask to join. You let them in after checking their code.</p>
        </section>
        {channel.youOwn && (
          <section className="invite-can" aria-label="New people can">
            <Heading>New people can</Heading>
            <Track className="seg invite-seg" role="group" aria-label="New people can">
              {CAN.map((c) => (
                <button key={c.id} type="button" title={c.says} aria-pressed={can === c.id} onClick={() => app.actions.setNewMembers(channel.code, c.id)}>
                  {c.label}
                </button>
              ))}
            </Track>
            <div className="invite-powers">
              <div className="invite-power" title="Every power below at once. The channel stays yours.">
                <span className="invite-power-label">Full trust</span>
                <Toggle
                  label="Full trust"
                  on={trust}
                  onChange={(on) => {
                    if (on) app.actions.setNewMembers(channel.code, "write")
                    app.actions.setNewPowers(channel.code, on ? ALL_POWERS : NO_POWERS)
                  }}
                />
              </div>
              {POWERS.map((power) => (
                <div key={power.id} className="invite-power" title={powers[power.id] ? power.on : power.off}>
                  <span className="invite-power-label">{power.label}</span>
                  <Toggle label={power.label} on={powers[power.id]} onChange={(on) => app.actions.setNewPowers(channel.code, { ...powers, [power.id]: on })} />
                </div>
              ))}
            </div>
            <p className="invite-note">You can change it for each person when you let them in.</p>
          </section>
        )}
      </div>
    </>
  )
}
