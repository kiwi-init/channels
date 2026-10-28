import { useState } from "react"

import type { Step, StepReply } from "@kiwi/core/protocol.ts"
import { Icon } from "~/kit/icons"
import { announce } from "~/kit/toasts"

export function stepReplyText(reply: StepReply): string {
  if (reply.outcome === "done") return reply.output ? `Done\n\n${reply.output}` : "Done"
  return `${reply.outcome === "cant" ? "Can't do it" : "Not needed"}: ${reply.reason}`
}

const copy = (command: string) =>
  navigator.clipboard.writeText(command).then(
    () => announce("Command copied"),
    () => announce("Couldn't copy. Select it and copy by hand.")
  )

export function StepHow({ step }: { step: Step }) {
  return (
    <section className="ask-step" aria-label="Step instructions">
      <p className="ask-why">{step.why}</p>
      <p className="ask-who">Needs a person: {step.needsPerson}</p>
      {step.do?.length ? (
        <ol className="ask-do">
          {step.do.map((item, i) => (
            <li key={`${i}:${item}`}>{item}</li>
          ))}
        </ol>
      ) : null}
      {step.run?.map((command, i) => (
        <div key={`${i}:${command}`} className="ask-run">
          <pre className="ask-code">
            <code>{command}</code>
          </pre>
          <button type="button" className="icon-btn" aria-label={`Copy command ${i + 1}`} title="Copy" onClick={() => void copy(command)}>
            <Icon name="copy" />
          </button>
        </div>
      ))}
      {step.expect && (
        <p className="ask-why">
          <span className="ask-label">Expected:</span> {step.expect}
        </p>
      )}
      {step.links?.length ? (
        <ul className="ask-links" aria-label="Step links">
          {step.links.map((link) => (
            <li key={link}>
              <a href={link} target="_blank" rel="noreferrer">
                {link}
              </a>
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
      <textarea className="textarea" rows={2} aria-label="Step output" placeholder="Output to send back with Done (optional)" value={output} onChange={(e) => setOutput(e.target.value)} />
      <div className="actions">
        <button type="button" className="btn is-primary is-small" onClick={() => onAnswer({ outcome: "done", ...(output.trim() ? { output } : {}) })}>
          Done
        </button>
        <button type="button" className="btn is-quiet is-small" aria-pressed={mode === "cant"} onClick={() => setMode(mode === "cant" ? null : "cant")}>
          Can't do it
        </button>
        <button type="button" className="btn is-quiet is-small" aria-pressed={mode === "not-needed"} onClick={() => setMode(mode === "not-needed" ? null : "not-needed")}>
          Not needed
        </button>
        <button type="button" className="btn is-quiet is-small" onClick={onElse}>
          Something else…
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
            aria-label="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "cant" ? "Why can't you do it?" : "Why isn't it needed?"}
            onKeyDown={(e) => e.key === "Escape" && setMode(null)}
          />
          <button type="submit" className="btn is-primary is-small" disabled={!reason.trim()}>
            Send
          </button>
        </form>
      )}
    </div>
  )
}
