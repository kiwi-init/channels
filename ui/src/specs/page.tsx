import "~/styles/specs.css"

import { useState } from "react"

import { cx } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { MoreButton } from "~/kit/menu-open"
import { ago } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct, useApp, type SpecPart } from "~/nav"
import { nickname } from "~/names"
import { SpecDoc } from "~/specs/doc"
import { Inside } from "~/specs/inside"
import { Result } from "~/specs/result"
import { alarmsOf, boxesOf, commentsOf, freeCount, insideOf, stageLine } from "~/specs/read"

export function SpecPage({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { nav, go } = useApp()
  const part: SpecPart = nav.part ?? "spec"
  const [editing, setEditing] = useState(false)
  const line = stageLine(channel, spec)
  const comments = commentsOf(channel, spec.ask)
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
          <button type="button" className="icon-btn spec-back" aria-label="All specs" title="All specs" onClick={() => go({ to: "spec", ask: null })}>
            <Icon name="back" />
          </button>
          <h1 className="spec-title">{spec.title}</h1>
          <span className={cx("spec-chip", line.tone)}>{line.word}</span>
          <div className="spec-head-end">
            <Track className="seg spec-parts" role="group" aria-label="Spec, inside or result">
              <button type="button" aria-pressed={part === "spec"} onClick={() => go({ to: "spec", ask: spec.ask, part: "spec" })}>
                Spec
                {comments.length > 0 && <span className="gh-n num">{comments.length}</span>}
              </button>
              <button type="button" aria-pressed={part === "inside"} onClick={() => go({ to: "spec", ask: spec.ask, part: "inside" })}>
                Inside
                {alarms.length > 0 ? <span className="spec-part-dot" aria-label={`${alarms.length} to look at`} /> : inside > 1 && <span className="gh-n num">{inside}</span>}
              </button>
              <button type="button" aria-pressed={part === "result"} onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
                Result
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
          <span>
            asked by {nickname(channel, spec.by)} {ago(spec.at)}
          </span>
          {spec.approved && !spec.changed && (
            <span>
              approved by {nickname(channel, spec.approved.by)} {ago(spec.approved.at)}
            </span>
          )}
          {(spec.stage === "queued" || spec.stage === "working") && !spec.changed && <span>{line.line}</span>}
          {spec.result && (
            <span className={line.tone}>
              {spec.result.auto ? "closed by itself" : `${spec.result.verdict} by ${nickname(channel, spec.result.by)}`} {ago(spec.result.at)}
              {spec.result.note ? `: “${spec.result.note}”` : ""}
            </span>
          )}
          {spec.backs.length > 0 && <span>sent back {spec.backs.length === 1 ? "once" : `${spec.backs.length} times`}</span>}
        </p>
        <blockquote className="spec-words">“{spec.words}”</blockquote>
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
  const label = `#${spec.ask}'s spec`
  const open = spec.tasks.filter((id) => channel.tasks.some((t) => t.id === id && t.status !== "done")).length
  const withTasks = open ? ` Its ${open === 1 ? "open task is" : `${open} open tasks are`} cancelled with it.` : ""
  if (spec.result && !spec.canJudge) return null
  return (
    <MoreButton
      label={label}
      groups={() => [
        [
          ...(spec.result ? [] : [{ label: "Edit", run: onEdit }]),
          ...(spec.result || !spec.canJudge
            ? []
            : [
                {
                  label: "Cancel…",
                  run: () => actions.judgeSpec(channel.code, spec.ask, "dropped"),
                  confirm: { title: `Cancel ${label}?`, sub: `It moves under Dropped, and no new work goes under it.${withTasks}`, yes: "Cancel spec" },
                },
              ]),
        ],
        spec.canJudge
          ? [
              {
                label: "Delete…",
                run: () => actions.deleteSpec(channel.code, spec.ask),
                confirm: { title: `Delete ${label}?`, sub: `It leaves the specs list. The history keeps one line saying you deleted it.${withTasks}`, yes: "Delete spec" },
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
          <p className="spec-gate-head">{spec.canJudge ? "Approve it and it starts when an agent is free." : `Waiting for ${nickname(channel, spec.by)} to approve it.`}</p>
          {free > 0 && <p className="spec-gate-sub num">{free} free now</p>}
        </div>
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            Approve
          </button>
        )}
      </div>
    )
  if (spec.changed)
    return (
      <div className="spec-gate is-changed">
        <div className="spec-gate-text">
          <p className="spec-gate-head tone-decide">
            {nickname(channel, spec.edited.by)} changed it after {nickname(channel, spec.approved?.by ?? spec.by)} approved it.
          </p>
          <p className="spec-gate-sub">New work waits for this approval.</p>
        </div>
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            Approve the change
          </button>
        )}
      </div>
    )
  return (
    <div className="spec-gate is-delivered">
      <div className="spec-gate-text">
        <p className="spec-gate-head tone-decide">Delivered: every task done, every box ticked.</p>
        {!spec.canJudge && <p className="spec-gate-sub">Waiting for {nickname(channel, spec.by)}'s verdict.</p>}
      </div>
      {spec.canJudge && part !== "result" && (
        <button type="button" className="btn is-primary" onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
          Open the result
        </button>
      )}
    </div>
  )
}
