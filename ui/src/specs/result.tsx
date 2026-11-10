import "~/i18n/en/specs"
import { useState } from "react"

import { tickDoneWhen } from "@kiwi/core/state.ts"

import { PrChip } from "~/chat/cards"
import { DiffBar } from "~/github/parts"
import { t } from "~/i18n/i18n"
import { cx, Dot } from "~/kit/bits"
import { Confirm } from "~/kit/confirm"
import { ago } from "~/kit/time"
import type { Channel, Spec, Task } from "~/model"
import { useAct } from "~/nav"
import { nickname, Shown } from "~/names"
import { Inline } from "~/specs/inline"
import { boxesOf, tasksOf } from "~/specs/read"
import { wordsPlain, wordsRaw } from "~/words"

const whyCancelled = (task: Task, nicknames: ReadonlyMap<string, string>): string => {
  const note = task.notes.at(-1)
  return note ? t("specs.result.cancelled.note", { note: wordsPlain(note.text, nicknames) }) : t("specs.result.cancelled")
}

export function Result({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { actions, go } = useAct()
  const [back, setBack] = useState(false)
  const [note, setNote] = useState("")
  const [asking, setAsking] = useState<"drop" | "early" | null>(null)
  const title = wordsPlain(spec.title, channel.nicknames)
  const boxes = boxesOf(spec)
  const tasks = tasksOf(channel, spec)
  const kept = tasks.filter((task) => !task.cancelled)
  const tried = tasks.filter((task) => task.cancelled)
  const prs = kept.flatMap((task) => (task.pr ? [task.pr] : []))
  const adds = prs.reduce((n, p) => n + (p.additions ?? 0), 0)
  const dels = prs.reduce((n, p) => n + (p.deletions ?? 0), 0)
  const files = prs.reduce((n, p) => n + (p.files ?? 0), 0)
  const merged = prs.filter((p) => p.state === "merged").length
  const ready = spec.stage === "delivered"
  const tick = (text: string, done: boolean) => {
    const next = tickDoneWhen(wordsRaw(spec.text), text, done)
    if ("text" in next) actions.writeSpec(channel.code, spec.ask, next.text)
  }
  const judge = spec.canJudge && !spec.result
  return (
    <div className="spec-result">
      <section className={cx("result-head", ready && "is-ready")}>
        <div className="result-head-text">
          <p className="result-words">
            {spec.result
              ? spec.result.auto
                ? t("specs.result.closed.by.itself", { when: ago(spec.result.at) })
                : t(spec.result.verdict === "accepted" ? "specs.result.accepted.by" : "specs.result.dropped.by", { who: nickname(channel, spec.result.by), when: ago(spec.result.at) })
              : ready
                ? t("specs.result.delivered", { when: ago(Math.max(...kept.map((task) => task.updatedAt), spec.edited.at)) })
                : spec.stage === "draft"
                  ? t("specs.result.nothing.yet")
                  : t("specs.result.not.delivered")}
          </p>
          {(spec.result?.note || (ready && !spec.canJudge) || (!spec.result && !ready)) && (
            <p className="result-sub">
              {spec.result
                ? spec.result.note
                  ? t("specs.result.note", { note: wordsPlain(spec.result.note, channel.nicknames) })
                  : ""
                : ready
                  ? t("specs.result.waits.verdict", { who: nickname(channel, spec.by) })
                  : spec.stage === "draft"
                    ? t("specs.result.no.work")
                    : t("specs.result.lands.here")}
            </p>
          )}
        </div>
        {judge && !back && (
          <div className="result-actions">
            <button type="button" className="btn is-quiet is-danger-text" onClick={() => setAsking("drop")}>
              {t("specs.result.drop")}
            </button>
            {spec.approved && (
              <button type="button" className="btn" onClick={() => setBack(true)}>
                {t("specs.result.send.back")}
              </button>
            )}
            <button
              type="button"
              className={cx("btn", ready && "is-primary")}
              disabled={!ready && !spec.approved}
              onClick={() => (ready ? actions.judgeSpec(channel.code, spec.ask, "accepted") : setAsking("early"))}
            >
              {t("specs.result.accept")}
            </button>
          </div>
        )}
        <Confirm
          open={asking === "drop"}
          title={t("specs.result.drop.ask", { title })}
          sub={t("specs.result.drop.sub")}
          action={t("specs.result.drop")}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            actions.judgeSpec(channel.code, spec.ask, "dropped")
          }}
        />
        <Confirm
          open={asking === "early"}
          title={t("specs.result.early.ask", { title })}
          sub={t("specs.result.early.sub")}
          action={t("specs.result.early.yes")}
          onClose={() => setAsking(null)}
          onConfirm={() => {
            setAsking(null)
            actions.judgeSpec(channel.code, spec.ask, "accepted")
          }}
        />
        {judge && back && (
          <div className="result-back">
            <textarea
              className="textarea"
              rows={3}
              value={note}
              autoFocus
              placeholder={t("specs.result.back.placeholder")}
              aria-label={t("specs.result.back.label")}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="result-actions">
              <button type="button" className="btn is-quiet" onClick={() => setBack(false)}>
                {t("specs.result.cancel")}
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
                {t("specs.result.send.it.back")}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="result-cols">
        <div className="result-col">
          <section className="result-part" aria-label={t("specs.result.done.when")}>
            <h2 className="inside-h">
              <span className="inside-h-name">{t("specs.result.done.when")}</span>
            </h2>
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
                      title={b.done ? t("specs.result.untick") : t("specs.result.tick")}
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
              <p className="inside-none">{t("specs.result.no.boxes")}</p>
            )}
          </section>

          {(tried.length > 0 || spec.backs.length > 0) && (
            <section className="result-part" aria-label={t("specs.result.tried.label")}>
              <h2 className="inside-h">
                <span className="inside-h-name">{t("specs.result.tried")}</span>
              </h2>
              <ul className="result-tried">
                {tried.map((task) => (
                  <li key={task.id}>
                    <span className="num">T{task.id}</span> <Shown value={task.title} /> <span className="dimmer">{whyCancelled(task, channel.nicknames)}</span>
                  </li>
                ))}
                {spec.backs.map((b) => (
                  <li key={b.at}>
                    {t("specs.result.sent.back.by", { who: nickname(channel, b.by), when: ago(b.at) })}{" "}
                    <span className="dimmer">
                      “<Shown value={b.note} />”
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="result-part result-proof" aria-label={t("specs.result.proof")}>
          <h2 className="inside-h">
            <span className="inside-h-name">{t("specs.result.came.of.it")}</span>
            {prs.length > 0 && (
              <span className="result-size num">
                {t("specs.result.size", { merged, total: prs.length, files })}
                <span className="tone-live">+{adds}</span> <span className="tone-alert">−{dels}</span>
                <DiffBar additions={adds} deletions={dels} />
              </span>
            )}
          </h2>
          {kept.length ? (
            <ul className="inside-tasks">
              {kept.map((task) => (
                <li key={task.id}>
                  <button type="button" className="inside-task" onClick={() => go({ to: "panel", panel: { kind: "task", task: task.id } })}>
                    <Dot status={task.status} />
                    <span className="inside-task-title">
                      <Shown value={task.title} />
                    </span>
                    <span className="inside-task-meta num">
                      <span>T{task.id}</span>
                      {task.owner && <span>{nickname(channel, task.owner)}</span>}
                      {task.rounds.some((r) => r.result === "approved") && (
                        <span>{t("specs.result.reviewed.by", { who: nickname(channel, task.rounds.find((r) => r.result === "approved")?.judge ?? task.reviewer ?? "") })}</span>
                      )}
                    </span>
                  </button>
                  {task.pr && <PrChip pr={task.pr} />}
                </li>
              ))}
            </ul>
          ) : (
            <p className="inside-none">{t("specs.result.no.tasks")}</p>
          )}
        </section>
      </div>
    </div>
  )
}
