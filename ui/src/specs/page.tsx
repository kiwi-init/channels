import "~/i18n/en/specs"
import "~/styles/specs.css"

import { useState } from "react"

import { t } from "~/i18n/i18n"
import { cx } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { MoreButton } from "~/kit/menu-open"
import { ago } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct, useApp, type SpecPart } from "~/nav"
import { nickname, Shown } from "~/names"
import { wordsPlain } from "~/words"
import { SpecDoc } from "~/specs/doc"
import { Inside } from "~/specs/inside"
import { Result } from "~/specs/result"
import { alarmsOf, boxesOf, commentsOf, freeCount, insideOf, stageLine } from "~/specs/read"

export function SpecPage({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { nav, go } = useApp()
  const part: SpecPart = nav.part ?? "spec"
  const [editing, setEditing] = useState(false)
  const line = stageLine(channel, spec)
  const comments = commentsOf(channel, spec)
  const inside = insideOf(channel, spec).length
  const alarms = alarmsOf(channel, spec)
  const boxes = boxesOf(spec)
  const asks = spec.stage === "draft" || !!spec.changed || (spec.stage === "delivered" && part !== "result")
  const edit = () => {
    setEditing(true)
    if (part !== "spec") go({ to: "spec", ask: spec.ask, part: "spec" })
  }
  return (
    <div className="spec-page">
      <div className="spec-top">
        <div className="spec-head">
          <button type="button" className="icon-btn spec-back" aria-label={t("specs.page.all.specs")} title={t("specs.page.all.specs")} onClick={() => go({ to: "spec", ask: null })}>
            <Icon name="back" />
          </button>
          <h1 className="spec-title">
            <Shown value={spec.title} />
          </h1>
          <span className={cx("spec-chip", line.tone)}>{line.word}</span>
          <div className="spec-head-end">
            <Track className="seg spec-parts" role="group" aria-label={t("specs.page.parts")}>
              <button type="button" aria-pressed={part === "spec"} onClick={() => go({ to: "spec", ask: spec.ask, part: "spec" })}>
                {t("specs.page.spec")}
                {comments.length > 0 && <span className="gh-n num">{comments.length}</span>}
              </button>
              <button type="button" aria-pressed={part === "inside"} onClick={() => go({ to: "spec", ask: spec.ask, part: "inside" })}>
                {t("specs.page.inside")}
                {alarms.length > 0 ? <span className="spec-part-dot" aria-label={t("specs.page.to.look.at", { count: alarms.length })} /> : inside > 1 && <span className="gh-n num">{inside}</span>}
              </button>
              <button type="button" aria-pressed={part === "result"} onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
                {t("specs.page.result")}
                {boxes.length > 0 && (
                  <span className="gh-n num">
                    {boxes.filter((b) => b.done).length}/{boxes.length}
                  </span>
                )}
              </button>
            </Track>
            {!editing && <SpecMenu channel={channel} spec={spec} onEdit={edit} />}
          </div>
        </div>
        <p className="spec-sub">
          <span className="num">#{spec.ask}</span>
          <span>{t("specs.page.asked.by", { who: nickname(channel, spec.by), when: ago(spec.at) })}</span>
          {spec.approved && !spec.changed && <span>{t("specs.page.approved.by", { who: nickname(channel, spec.approved.by), when: ago(spec.approved.at) })}</span>}
          {(spec.stage === "queued" || spec.stage === "working") && !spec.changed && <span>{line.line}</span>}
          {spec.result && (
            <span className={line.tone}>
              {spec.result.auto
                ? t("specs.page.closed.by.itself")
                : t(spec.result.verdict === "accepted" ? "specs.page.accepted.by" : "specs.page.dropped.by", { who: nickname(channel, spec.result.by) })}{" "}
              {ago(spec.result.at)}
              {spec.result.note ? t("specs.page.result.note", { note: wordsPlain(spec.result.note, channel.nicknames) }) : ""}
            </span>
          )}
          {spec.backs.length > 0 && <span>{spec.backs.length === 1 ? t("specs.page.sent.back.once") : t("specs.page.sent.back.times", { count: spec.backs.length })}</span>}
        </p>
        <blockquote className="spec-words">
          “<Shown value={spec.words} />”
        </blockquote>
        {asks && <Gate channel={channel} spec={spec} editing={editing} part={part} />}
      </div>
      {part === "spec" ? (
        <SpecDoc channel={channel} spec={spec} editing={editing} onEditing={setEditing} />
      ) : part === "inside" ? (
        <Inside channel={channel} spec={spec} />
      ) : (
        <Result channel={channel} spec={spec} />
      )}
    </div>
  )
}

function SpecMenu({ channel, spec, onEdit }: { channel: Channel; spec: Spec; onEdit: () => void }) {
  const { actions } = useAct()
  const label = t("specs.page.menu.label", { ask: String(spec.ask) })
  const open = spec.tasks.filter((id) => channel.tasks.some((task) => task.id === id && task.status !== "done")).length
  const withTasks = (first: string): string => (open ? t("specs.page.two.sentences", { first, second: open === 1 ? t("specs.page.open.task") : t("specs.page.open.tasks", { count: open }) }) : first)
  if (spec.result && !spec.canJudge) return null
  return (
    <MoreButton
      label={label}
      groups={() => [
        [
          ...(spec.result ? [] : [{ label: t("specs.page.edit"), run: onEdit }]),
          ...(spec.result || !spec.canJudge
            ? []
            : [
                {
                  label: t("specs.page.cancel"),
                  run: () => actions.judgeSpec(channel.code, spec.ask, "dropped"),
                  confirm: { title: t("specs.page.cancel.title", { spec: label }), sub: withTasks(t("specs.page.cancel.sub")), yes: t("specs.page.cancel.yes") },
                },
              ]),
        ],
        spec.canJudge
          ? [
              {
                label: t("specs.page.delete"),
                run: () => actions.deleteSpec(channel.code, spec.ask),
                confirm: { title: t("specs.page.delete.title", { spec: label }), sub: withTasks(t("specs.page.delete.sub")), yes: t("specs.page.delete.yes") },
              },
            ]
          : [],
      ]}
    />
  )
}

function Gate({ channel, spec, editing, part }: { channel: Channel; spec: Spec; editing: boolean; part: SpecPart }) {
  const { actions, go } = useAct()
  const free = freeCount(channel)
  if (spec.stage === "draft")
    return (
      <div className="spec-gate is-draft">
        <div className="spec-gate-text">
          <p className="spec-gate-head">{spec.canJudge ? t("specs.page.gate.approve") : t("specs.page.gate.waiting", { who: nickname(channel, spec.by) })}</p>
          {free > 0 && <p className="spec-gate-sub num">{t("specs.page.gate.free", { count: free })}</p>}
        </div>
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            {t("specs.page.approve")}
          </button>
        )}
      </div>
    )
  if (spec.changed)
    return (
      <div className="spec-gate is-changed">
        <div className="spec-gate-text">
          <p className="spec-gate-head tone-decide">{t("specs.page.gate.changed", { who: nickname(channel, spec.edited.by), approver: nickname(channel, spec.approved?.by ?? spec.by) })}</p>
          <p className="spec-gate-sub">{t("specs.page.gate.changed.sub")}</p>
        </div>
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            {t("specs.page.approve.change")}
          </button>
        )}
      </div>
    )
  return (
    <div className="spec-gate is-delivered">
      <div className="spec-gate-text">
        <p className="spec-gate-head tone-decide">{t("specs.page.gate.delivered")}</p>
        {!spec.canJudge && <p className="spec-gate-sub">{t("specs.page.gate.verdict", { who: nickname(channel, spec.by) })}</p>}
      </div>
      {spec.canJudge && part !== "result" && (
        <button type="button" className="btn is-primary" onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
          {t("specs.page.open.result")}
        </button>
      )}
    </div>
  )
}
