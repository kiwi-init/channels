import { useState } from "react"

import type { Step, StepReply } from "@kiwi/core/protocol.ts"
import { useChoosing } from "@/lib/choosing"
import { Button, FIELD, TextField, toast } from "./kit"

export function stepReplyText(reply: StepReply): string {
  if (reply.outcome === "done") return reply.output ? `Done\n\n${reply.output}` : "Done"
  return `${reply.outcome === "cant" ? "Can't do it" : "Not needed"}: ${reply.reason}`
}

export function StepDetails({ step }: { step: Step }) {
  return (
    <section aria-label="Step instructions" className="flex flex-col gap-2 text-ui leading-normal">
      <p className="whitespace-pre-wrap text-ink-2">{step.why}</p>
      <p className="text-meta text-ink-3">Needs a person: {step.needsPerson}</p>
      {step.do?.length ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 whitespace-pre-wrap">
          {step.do.map((item, i) => (
            <li key={`${i}:${item}`}>{item}</li>
          ))}
        </ol>
      ) : null}
      {step.run?.map((command, i) => (
        <div key={`${i}:${command}`} className="relative min-w-0 rounded-ctl bg-(--well)">
          <pre className="overflow-x-auto px-3 py-2 pr-20 text-ui whitespace-pre">
            <code>{command}</code>
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="absolute top-1 right-1 bg-(--well)"
            onClick={() => navigator.clipboard.writeText(command).then(() => toast("Command copied"))}
            aria-label={`Copy command ${i + 1}`}
          >
            Copy
          </Button>
        </div>
      ))}
      {step.expect && (
        <p className="whitespace-pre-wrap text-ink-2">
          <span className="font-medium text-ink">Expected:</span> {step.expect}
        </p>
      )}
      {step.links?.length ? (
        <ul aria-label="Step links" className="flex flex-col gap-1">
          {step.links.map((link) => (
            <li key={link} className="[overflow-wrap:anywhere]">
              <a href={link} target="_blank" rel="noreferrer" className="font-medium text-accent-text hover:underline">
                {link}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

export function StepResponse({ id, disabled, onAnswer, onElse }: { id: number; disabled: boolean; onAnswer: (reply: StepReply) => Promise<boolean>; onElse: () => void }) {
  const choose = useChoosing<StepReply>(id, onAnswer)
  return <StepFields key={id} disabled={disabled || choose.busy} onAnswer={(reply) => !disabled && choose.pick(reply)} onElse={onElse} />
}

function StepFields({ disabled, onAnswer, onElse }: { disabled: boolean; onAnswer: (reply: StepReply) => void; onElse: () => void }) {
  const [output, setOutput] = useState("")
  const [mode, setMode] = useState<"cant" | "not-needed" | null>(null)
  const [reason, setReason] = useState("")
  const send = (reply: StepReply) => onAnswer(reply)
  const unavailable = disabled
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-meta text-ink-3">
        Output from the step (optional)
        <textarea
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          rows={2}
          aria-label="Step output"
          placeholder="Paste output to send back with Done"
          className={`min-h-16 resize-y rounded-ctl px-3 py-2 text-body ${FIELD}`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" disabled={unavailable} onClick={() => void send({ outcome: "done", ...(output.trim() ? { output } : {}) })}>
          Done
        </Button>
        <Button size="sm" variant="ghost" disabled={unavailable} onClick={() => setMode(mode === "cant" ? null : "cant")}>
          Can’t do it
        </Button>
        <Button size="sm" variant="ghost" disabled={unavailable} onClick={() => setMode(mode === "not-needed" ? null : "not-needed")}>
          Not needed
        </Button>
        <Button size="sm" variant="ghost" disabled={unavailable} onClick={onElse}>
          Something else
        </Button>
      </div>
      {mode && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) void send({ outcome: mode, reason: reason.trim() })
          }}
        >
          <TextField
            autoFocus
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason"
            placeholder={mode === "cant" ? "Why can’t you do it?" : "Why isn’t it needed?"}
            className="flex-1"
          />
          <Button size="sm" variant="secondary" type="submit" disabled={unavailable || !reason.trim()}>
            Send
          </Button>
        </form>
      )}
    </div>
  )
}
