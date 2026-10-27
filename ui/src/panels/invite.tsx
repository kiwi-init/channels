import { useEffect, useState } from "react"

import "~/styles/people-add.css"
import { cx, Heading } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"

type Link = { code: string; link: string } | { code: string; failed: true }

export function useInviteLink(code: string): { link: string | null; failed: boolean; retry: () => void } {
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

export const inviteCode = (link: string): string => link.slice(link.lastIndexOf("/") + 1)

export function CopyBox({ text, label, disabled }: { text: string | null; label: string; disabled?: boolean }) {
  const { toast } = useApp()
  return (
    <div className={cx("codebox invite-box", disabled && "is-off")}>
      <code>{text ?? "…"}</code>
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        title={label}
        disabled={!text || disabled}
        onClick={() => {
          if (!text) return
          navigator.clipboard.writeText(text).then(
            () => toast("Copied"),
            () => toast("Couldn't copy. Select it and copy by hand.")
          )
        }}
      >
        <Icon name="copy" />
      </button>
    </div>
  )
}

const CAN = [
  { id: "read", label: "Only read", says: "They see every room and task, and can't post." },
  { id: "write", label: "Write and work", says: "They post, take tasks and bring their own agents." },
] as const

export function InvitePanel({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const { link, failed, retry } = useInviteLink(channel.code)
  const can = channel.newMembers ?? "write"
  return (
    <>
      <PanelHead title="Invite people" />
      <div className="panel-body">
        <section className="panel-section" aria-label="Invite link">
          <Heading>Invite link</Heading>
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
          <p className="invite-note">Anyone with this link can ask to join. You let them in after checking their code.</p>
        </section>
        {channel.youOwn && (
          <section className="panel-section" aria-label="New people can">
            <Heading>New people can</Heading>
            <div className="seg invite-seg" role="group" aria-label="New people can">
              {CAN.map((c) => (
                <button key={c.id} type="button" aria-pressed={can === c.id} onClick={() => app.actions.setNewMembers(channel.code, c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="invite-note">{CAN.find((c) => c.id === can)?.says}</p>
          </section>
        )}
      </div>
    </>
  )
}
