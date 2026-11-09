import { useState, type ReactNode } from "react"

import type { Step, StepReply } from "@kiwi/core/protocol.ts"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { Icon } from "~/kit/icons"
import { OutsideLink } from "~/kit/outside"
import { copyText } from "~/kit/toasts"

export function stepReplyText(reply: StepReply): string {
  if (reply.outcome === "done") return reply.output ? `Done\n\n${reply.output}` : "Done"
  return `${reply.outcome === "cant" ? "Can't do it" : "Not needed"}: ${reply.reason}`
}

const copy = (command: string) => copyText(command, t("chat.step.copied"))

const asIs = (s: string): ReactNode => s

export function StepHow({ step, you = [], text = asIs }: { step: Step; you?: readonly string[]; text?: (s: string) => ReactNode }) {
  const mine = you.some((n) => n.toLowerCase() === step.needsPerson.trim().toLowerCase())
  return (
    <section className="ask-step" aria-label={t("chat.step.instructions")}>
      <p className="ask-why">{text(step.why)}</p>
      {!mine && <p className="ask-who">{tr("chat.step.needs.person", { who: text(step.needsPerson) })}</p>}
      {step.do?.length ? (
        <ol className="ask-do">
          {step.do.map((item, i) => (
            <li key={`${i}:${item}`}>{text(item)}</li>
          ))}
        </ol>
      ) : null}
      {step.run?.map((command, i) => (
        <div key={`${i}:${command}`} className="ask-run">
          <pre className="ask-code">
            <code>{command}</code>
          </pre>
          <button type="button" className="icon-btn" aria-label={t("chat.step.copy.command", { n: i + 1 })} title={t("chat.step.copy")} onClick={() => void copy(command)}>
            <Icon name="copy" />
          </button>
        </div>
      ))}
      {step.expect && (
        <p className="ask-why">
          <span className="ask-label">{t("chat.step.expected")}</span> {text(step.expect)}
        </p>
      )}
      {step.links?.length ? (
        <ul className="ask-links" aria-label={t("chat.step.links")}>
          {step.links.map((link) => (
            <li key={link}>
              <OutsideLink href={link}>{link}</OutsideLink>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function StepAnswer({ onAnswer, onElse }: { onAnswer: (reply: StepReply) => void; onElse: () => void }) {
  const [output, setOutput] = useState("")
  const [mode, setMode] = useState<"cant" | "not-needed" | null>(null)
  const [reason, setReason] = useState("")
  return (
    <div className="ask-step-answer">
      <textarea
        className="textarea"
        rows={1}
        aria-label={t("chat.step.output")}
        title={t("chat.step.output.title")}
        placeholder={t("chat.step.output.placeholder")}
        value={output}
        onChange={(e) => setOutput(e.target.value)}
      />
      <div className="actions">
        <button type="button" className="btn is-primary is-small" onClick={() => onAnswer({ outcome: "done", ...(output.trim() ? { output } : {}) })}>
          {t("chat.step.done")}
        </button>
        <button type="button" className="btn is-quiet is-small" aria-pressed={mode === "cant"} onClick={() => setMode(mode === "cant" ? null : "cant")}>
          {t("chat.step.cant")}
        </button>
        <button type="button" className="btn is-quiet is-small" aria-pressed={mode === "not-needed"} onClick={() => setMode(mode === "not-needed" ? null : "not-needed")}>
          {t("chat.step.not.needed")}
        </button>
        <button type="button" className="btn is-quiet is-small" onClick={onElse}>
          {t("chat.step.something.else")}
        </button>
      </div>
      {mode && (
        <form
          className="ask-other"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) onAnswer({ outcome: mode, reason: reason.trim() })
          }}
        >
          <input
            autoFocus
            className="input"
            aria-label={t("chat.step.reason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "cant" ? t("chat.step.why.cant") : t("chat.step.why.not.needed")}
            onKeyDown={(e) => e.key === "Escape" && setMode(null)}
          />
          <button type="submit" className="btn is-primary is-small" disabled={!reason.trim()}>
            {t("chat.step.send")}
          </button>
        </form>
      )}
    </div>
  )
}
