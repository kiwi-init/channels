import "~/styles/specs.css"

import { useState } from "react"

import { cx } from "~/kit/bits"
import { Track } from "~/kit/glide"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct, useApp, type SpecPart } from "~/nav"
import { nickname } from "~/names"
import { SpecMark } from "~/specs/card"
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
  return (
    <div className="spec-page">
      <div className="spec-top">
        <button type="button" className="btn is-quiet is-small spec-back" onClick={() => go({ to: "spec", ask: null })}>
          <Icon name="back" size={14} />
          Specs
        </button>
        <div className="spec-title-row">
          <SpecMark spec={spec} />
          <h1 className="spec-title">{spec.title}</h1>
          <span className={cx("spec-chip", line.tone)}>{line.word}</span>
        </div>
        <p className="spec-sub">
          <span className="num">#{spec.ask}</span>
          <span>
            asked by {nickname(channel, spec.by)} {ago(spec.at)}
          </span>
          <span>
            {spec.edits} {spec.edits === 1 ? "version" : "versions"} · last by {nickname(channel, spec.edited.by)} {ago(spec.edited.at)}
          </span>
          {spec.editors.length > 1 && <span>written by {spec.editors.map((n) => nickname(channel, n)).join(", ")}</span>}
        </p>
        <blockquote className="spec-words">
          “{spec.words}” <span className="dimmer">· {nickname(channel, spec.by)}</span>
        </blockquote>
        {!(part === "result" && spec.stage === "delivered") && <Gate channel={channel} spec={spec} onEdit={() => setEditing(true)} editing={editing} part={part} />}
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

function Gate({ channel, spec, onEdit, editing, part }: { channel: Channel; spec: Spec; onEdit: () => void; editing: boolean; part: SpecPart }) {
  const { actions, go } = useAct()
  const line = stageLine(channel, spec)
  const free = freeCount(channel)
  const edit = !spec.result && !editing && (
    <button type="button" className="btn is-quiet" onClick={onEdit}>
      Edit
    </button>
  )
  if (spec.stage === "draft")
    return (
      <div className="spec-gate is-draft">
        <div className="spec-gate-text">
          <p className="spec-gate-head">{spec.canJudge ? "Read it, comment on any line, then approve it." : `Waiting for ${nickname(channel, spec.by)} to approve it.`}</p>
          <p className="spec-gate-sub">Approved, it starts by itself as soon as an agent is free{free ? ` (${free} free now)` : ""}. Anything outside it comes back to you as a change.</p>
        </div>
        {edit}
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            Approve and auto-start
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
          <p className="spec-gate-sub">Work already started goes on. New work waits until a person approves the change; the lines that changed are marked below.</p>
        </div>
        {edit}
        {spec.canJudge && !editing && (
          <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
            Approve the change
          </button>
        )}
      </div>
    )
  if (spec.stage === "delivered")
    return (
      <div className="spec-gate is-delivered">
        <div className="spec-gate-text">
          <p className="spec-gate-head tone-decide">Delivered: every task is done and every box under Done when is ticked.</p>
          <p className="spec-gate-sub">{spec.canJudge ? "Look at the result, then accept it or send it back with a note." : `Waiting for ${nickname(channel, spec.by)}'s verdict.`}</p>
        </div>
        {spec.canJudge && part !== "result" && (
          <button type="button" className="btn is-primary" onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
            Open the result
          </button>
        )}
      </div>
    )
  return (
    <div className={cx("spec-gate", `is-${spec.stage}`)}>
      <div className="spec-gate-text">
        <p className="spec-gate-head">
          <span className={line.tone}>{line.word}</span>
          <span className="spec-gate-line"> · {line.line}</span>
        </p>
        {spec.approved && (
          <p className="spec-gate-sub">
            Approved by {nickname(channel, spec.approved.by)} {ago(spec.approved.at)}
            {spec.backs.length ? ` · sent back ${spec.backs.length === 1 ? "once" : `${spec.backs.length} times`}` : ""}
            {spec.result?.note ? ` · “${spec.result.note}”` : ""}
          </p>
        )}
      </div>
      {edit}
    </div>
  )
}
