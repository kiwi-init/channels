import { useState } from "react"

import { tickDoneWhen } from "@kiwi/core/state.ts"

import { PrChip } from "~/chat/cards"
import { DiffBar } from "~/github/parts"
import { cx, Dot } from "~/kit/bits"
import { ago } from "~/kit/time"
import type { Channel, Spec } from "~/model"
import { useAct } from "~/nav"
import { nickname } from "~/names"
import { Inline } from "~/specs/inline"
import { boxesOf, tasksOf } from "~/specs/read"

export function Result({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { actions, go } = useAct()
  const [back, setBack] = useState(false)
  const [note, setNote] = useState("")
  const boxes = boxesOf(spec)
  const tasks = tasksOf(channel, spec)
  const kept = tasks.filter((t) => !t.cancelled)
  const tried = tasks.filter((t) => t.cancelled)
  const prs = kept.flatMap((t) => (t.pr ? [t.pr] : []))
  const adds = prs.reduce((n, p) => n + (p.additions ?? 0), 0)
  const dels = prs.reduce((n, p) => n + (p.deletions ?? 0), 0)
  const files = prs.reduce((n, p) => n + (p.files ?? 0), 0)
  const merged = prs.filter((p) => p.state === "merged").length
  const ready = spec.stage === "delivered"
  const tick = (text: string, done: boolean) => {
    const next = tickDoneWhen(spec.text, text, done)
    if ("text" in next) actions.writeSpec(channel.code, spec.ask, next.text)
  }
  return (
    <div className="spec-result">
      <section className={cx("result-head", ready && "is-ready")}>
        <p className="result-words">
          {spec.result
            ? `${spec.result.verdict === "accepted" ? "Accepted" : "Dropped"} by ${nickname(channel, spec.result.by)} ${ago(spec.result.at)}`
            : ready
              ? `Delivered ${ago(Math.max(...kept.map((t) => t.updatedAt), spec.edited.at))}`
              : spec.stage === "draft"
                ? "Nothing yet"
                : "Not delivered yet"}
        </p>
        <p className="result-sub">
          {spec.result
            ? spec.result.note
              ? `“${spec.result.note}”`
              : "Its tasks, their PRs and what was tried stay here."
            : ready
              ? spec.canJudge
                ? "Every task is done and every box under Done when is ticked. Check the proof below, then accept it or send it back with a note."
                : `Every task is done and every box is ticked. It waits for ${nickname(channel, spec.by)}'s verdict.`
              : spec.stage === "draft"
                ? "The spec isn't approved, so no work has started."
                : "It lands here once every task is done and every box under Done when is ticked."}
        </p>
      </section>

      <section className="result-part" aria-label="Done when">
        <h2 className="inside-h">Done when</h2>
        {boxes.length ? (
          <ul className="spec-boxes">
            {boxes.map((b) => (
              <li key={b.text} className={cx(b.done && "is-done")}>
                <button
                  type="button"
                  className="spec-box-btn"
                  role="checkbox"
                  aria-checked={b.done}
                  disabled={!!spec.result}
                  title={b.done ? "Untick it" : "Tick it: it's proven"}
                  onClick={() => tick(b.text, !b.done)}
                >
                  <span className="spec-box" aria-hidden="true" />
                </button>
                <span>
                  <Inline text={b.text} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="inside-none">The spec has no boxes under “## Done when”, so its tasks being done is the whole proof.</p>
        )}
      </section>

      <section className="result-part" aria-label="The proof">
        <h2 className="inside-h">
          What came of it
          {prs.length > 0 && (
            <span className="result-size num">
              {merged}/{prs.length} merged · {files} files · <span className="tone-live">+{adds}</span> <span className="tone-alert">−{dels}</span>
              <DiffBar additions={adds} deletions={dels} />
            </span>
          )}
        </h2>
        {kept.length ? (
          <ul className="inside-tasks">
            {kept.map((t) => (
              <li key={t.id}>
                <button type="button" className="inside-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: t.id } })}>
                  <Dot status={t.status} />
                  <span className="inside-task-title">{t.title}</span>
                  <span className="inside-task-meta num">
                    <span>T{t.id}</span>
                    {t.owner && <span>{nickname(channel, t.owner)}</span>}
                    {t.rounds.some((r) => r.result === "approved") && <span>reviewed by {nickname(channel, t.rounds.find((r) => r.result === "approved")?.judge ?? t.reviewer ?? "")}</span>}
                  </span>
                </button>
                {t.pr && <PrChip pr={t.pr} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="inside-none">No tasks yet.</p>
        )}
      </section>

      {(tried.length > 0 || spec.backs.length > 0) && (
        <section className="result-part" aria-label="Tried and sent back">
          <h2 className="inside-h">Tried along the way</h2>
          <ul className="result-tried">
            {tried.map((t) => (
              <li key={t.id}>
                <span className="num">T{t.id}</span> {t.title} <span className="dimmer">· cancelled{t.notes.at(-1) ? `: ${t.notes.at(-1)!.text}` : ""}</span>
              </li>
            ))}
            {spec.backs.map((b) => (
              <li key={b.at}>
                Sent back by {nickname(channel, b.by)} {ago(b.at)}: <span className="dimmer">“{b.note}”</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {spec.canJudge && !spec.result && (
        <section className="result-verdict" aria-label="Your verdict">
          {back ? (
            <div className="result-back">
              <textarea
                className="textarea"
                rows={3}
                value={note}
                autoFocus
                placeholder="What's missing or wrong? The agents start again from your note."
                aria-label="Why it goes back"
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="result-actions">
                <button type="button" className="btn is-quiet" onClick={() => setBack(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn is-primary"
                  disabled={!note.trim()}
                  onClick={() => {
                    actions.judgeSpec(channel.code, spec.ask, "back", note)
                    setBack(false)
                    setNote("")
                  }}
                >
                  Send it back
                </button>
              </div>
            </div>
          ) : (
            <div className="result-actions">
              <button type="button" className="btn is-quiet is-danger-text" onClick={() => actions.judgeSpec(channel.code, spec.ask, "dropped")}>
                Drop it
              </button>
              {spec.approved && (
                <button type="button" className="btn" onClick={() => setBack(true)}>
                  Send back…
                </button>
              )}
              <button type="button" className={cx("btn", ready && "is-primary")} disabled={!ready && !spec.approved} onClick={() => actions.judgeSpec(channel.code, spec.ask, "accepted")}>
                Accept
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
