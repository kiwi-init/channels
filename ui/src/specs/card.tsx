import "~/i18n/en/specs"
import "~/styles/specs.css"

import type { CSSProperties } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel, Spec, SpecAsk } from "~/model"
import { useAct } from "~/nav"
import { nickname, Shown } from "~/names"
import { Inline } from "~/specs/inline"
import { boxesOf, commentsOf, faceOf, stageLine, tasksOf, workersOf } from "~/specs/read"
import { personGo } from "~/person-go"

export function SpecMark({ spec }: { spec: Spec }) {
  const boxes = boxesOf(spec)
  const done = boxes.filter((b) => b.done).length
  return <span className={cx("spec-mark", `is-${spec.changed ? "changed" : spec.stage}`)} aria-hidden="true" style={{ "--done": boxes.length ? done / boxes.length : 0 } as CSSProperties} />
}

export function SpecCard({ channel, spec }: { channel: Channel; spec: Spec }) {
  const { go } = useAct()
  const line = stageLine(channel, spec)
  const who = workersOf(channel, spec)
  const said = commentsOf(channel, spec).length
  const open = (part: "spec" | "inside" | "result") => go({ to: "spec", ask: spec.ask, part })
  return (
    <div className={cx("spec-card", `is-${spec.stage}`, spec.changed && "is-changed")}>
      <button type="button" className="spec-card-main" onClick={() => open(spec.stage === "delivered" ? "result" : spec.stage === "working" ? "inside" : "spec")}>
        <SpecMark spec={spec} />
        <span className="spec-card-kind">{t("specs.card.kind")}</span>
        <span className="spec-card-title">
          <Shown value={spec.title} />
        </span>
        <span className="spec-card-faces" aria-hidden="true">
          {who.slice(0, 3).map((n) => (
            <Avatar key={n} person={faceOf(channel, n)} size="sm" />
          ))}
        </span>
        <Icon name="chevron" size={12} />
        <span className="spec-card-meta">
          <span className={line.tone}>{line.word}</span>
          <span>{line.line}</span>
          {said > 0 && <span className="num">{t("specs.card.comments", { count: said })}</span>}
        </span>
      </button>
    </div>
  )
}

const NEED_VERB: Record<SpecAsk["why"], Key> = {
  approve: "specs.card.need.approve",
  changed: "specs.card.need.changed",
  result: "specs.card.need.result",
}

export function SpecNeedCard({ channel, ask }: { channel: Channel; ask: SpecAsk }) {
  const { actions, go } = useAct()
  const spec = channel.specs?.find((s) => s.ask === ask.ask)
  if (!spec) return null
  const by = ask.why === "result" ? (workersOf(channel, spec)[0] ?? tasksOf(channel, spec).at(-1)?.owner ?? spec.edited.by) : spec.edited.by
  const boxes = boxesOf(spec)
  return (
    <article className="needs-card is-open spec-need" aria-label={t("specs.card.need.label", { who: nickname(channel, by), verb: t(NEED_VERB[ask.why]) })}>
      <header className="needs-head">
        <Avatar person={faceOf(channel, by)} size="sm" />
        <button type="button" className="needs-name" onClick={() => go(personGo(channel, by))}>
          {nickname(channel, by)}
        </button>
        <span className="needs-verb">{t(NEED_VERB[ask.why])}</span>
        <span className="needs-meta">
          <time className="needs-time" dateTime={new Date(ask.at).toISOString()}>
            {ago(ask.at)}
          </time>
        </span>
      </header>
      <div className="needs-body">
        <p className="spec-need-title">
          <Shown value={spec.title} />
        </p>
        <p className="spec-need-words">
          “<Shown value={spec.words} />” <span className="dimmer">· {nickname(channel, spec.by)}</span>
        </p>
        {boxes.length > 0 && (
          <ul className="spec-boxes is-small">
            {boxes.map((b) => (
              <li key={b.text} className={cx(b.done && "is-done")}>
                <span className="spec-box" aria-hidden="true" />
                <span>
                  <Inline text={b.text} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="needs-foot">
        {ask.why === "approve" ? (
          <>
            <button type="button" className="btn is-primary" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
              {t("specs.card.approve")}
            </button>
            <button type="button" className="btn" onClick={() => go({ to: "spec", ask: spec.ask, part: "spec" })}>
              {t("specs.card.read.and.comment")}
            </button>
            <span className="spec-need-hint">{t("specs.card.starts.when.free")}</span>
          </>
        ) : ask.why === "changed" ? (
          <>
            <button type="button" className="btn is-primary" onClick={() => go({ to: "spec", ask: spec.ask, part: "spec" })}>
              {t("specs.card.see.changes")}
            </button>
            <button type="button" className="btn" onClick={() => actions.approveSpec(channel.code, spec.ask, spec.v)}>
              {t("specs.card.approve.change")}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn is-primary" onClick={() => go({ to: "spec", ask: spec.ask, part: "result" })}>
              {t("specs.card.open.result")}
            </button>
            <button type="button" className="btn" onClick={() => actions.judgeSpec(channel.code, spec.ask, "accepted")}>
              {t("specs.card.accept")}
            </button>
          </>
        )}
      </footer>
    </article>
  )
}
