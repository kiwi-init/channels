import "~/i18n/en/modals"
import { Fragment, useEffect, useState } from "react"

import "~/styles/people-add.css"
import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Toggle } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ALL_POWERS, NO_POWERS, trusted, type Channel } from "~/model"
import { useActions } from "~/nav"
import { Group, Row } from "~/settings/controls"
import { copyText } from "~/kit/toasts"

type Link = { code: string; link: string } | { code: string; failed: true }

function useInviteLink(code: string): { link: string | null; failed: boolean; retry: () => void } {
  const actions = useActions()
  const [got, setGot] = useState<Link | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    actions
      .inviteLink(code)
      .then((link) => live && setGot({ code, link }))
      .catch(() => live && setGot({ code, failed: true }))
    return () => {
      live = false
    }
  }, [actions, code, attempt])
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
  { id: "addsAgents", label: "modals.invite.power.adds.agents", on: "modals.invite.power.adds.agents.on", off: "modals.invite.power.adds.agents.off" },
  { id: "answersDecisions", label: "modals.invite.power.answers.decisions", on: "modals.invite.power.answers.decisions.on", off: "modals.invite.power.answers.decisions.off" },
  { id: "managesAgents", label: "modals.invite.power.manages.agents", on: "modals.invite.power.manages.agents.on", off: "modals.invite.power.manages.agents.off" },
] as const

const CAN = [
  { id: "read", label: "modals.invite.can.read", says: "modals.invite.can.read.says" },
  { id: "write", label: "modals.invite.can.write", says: "modals.invite.can.write.says" },
] as const

export function Invite({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const actions = useActions()
  const { link, failed, retry } = useInviteLink(channel.code)
  const can = channel.newMembers ?? "write"
  const powers = channel.newPowers ?? NO_POWERS
  const trust = can === "write" && trusted(powers)
  return (
    <Modal stays onClose={onClose} label={t("modals.invite.title")} title={t("modals.invite.title")} sub={t("modals.invite.sub")} size="narrow" className="invite">
      {failed ? (
        <div className="invite-failed">
          <span>{t("modals.invite.link.failed")}</span>
          <button type="button" className="btn is-small" onClick={retry}>
            {t("modals.invite.try.again")}
          </button>
        </div>
      ) : (
        <CopyBox text={link} label={t("modals.invite.copy.link")} />
      )}
      {channel.youOwn && (
        <Group title={t("modals.invite.new.people.can")} hint={t("modals.invite.new.people.can.hint")}>
          <div className="invite-can">
            <Track className="seg invite-seg" role="group" aria-label={t("modals.invite.new.people.can")}>
              {CAN.map((c) => (
                <button key={c.id} type="button" title={t(c.says)} aria-pressed={can === c.id} onClick={() => actions.setNewMembers(channel.code, c.id)}>
                  {t(c.label)}
                </button>
              ))}
            </Track>
          </div>
          <Row label={t("modals.invite.full.trust")} hint={t("modals.invite.full.trust.hint")}>
            <Toggle
              label={t("modals.invite.full.trust")}
              on={trust}
              onChange={(on) => {
                if (on) actions.setNewMembers(channel.code, "write")
                actions.setNewPowers(channel.code, on ? ALL_POWERS : NO_POWERS)
              }}
            />
          </Row>
          {POWERS.map((power) => (
            <Row key={power.id} label={t(power.label)} hint={t(powers[power.id] ? power.on : power.off)}>
              <Toggle label={t(power.label)} on={powers[power.id]} onChange={(on) => actions.setNewPowers(channel.code, { ...powers, [power.id]: on })} />
            </Row>
          ))}
        </Group>
      )}
    </Modal>
  )
}
