import { useEffect, useState } from "react"

import { Dialog, DialogHead, Field } from "~/kit/bits"
import type { RecoveryState } from "~/model"
import { useApp } from "~/nav"
import { Confirm, Row } from "~/settings/controls"
import { WordsForm } from "~/start/recover"

const SHOT = new URLSearchParams(location.search).get("shot")

type Step = { at: "words"; words: string[] } | { at: "check"; words: string[]; ask: number[]; typed: string[]; wrong: number[]; busy: boolean }

const day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" })

function pick(count: number): number[] {
  if (SHOT) return [3, 12, 20]
  const third = Math.floor(count / 3)
  return [0, 1, 2].map((i) => i * third + Math.floor(Math.random() * third))
}

const checking = (words: string[]): Extract<Step, { at: "check" }> => ({ at: "check", words, ask: pick(words.length), typed: ["", "", ""], wrong: [], busy: false })

const listed = (ask: number[]): string => {
  const n = ask.map((i) => String(i + 1))
  return `${n.slice(0, -1).join(", ")} and ${n.at(-1) ?? ""}`
}

function hintFor(recovery: RecoveryState): string {
  if (recovery.at) return "If you lose every computer, sign in on a new one and type them to get your account and channels back."
  if (recovery.here) return "Without it, losing this computer means losing the channels you own."
  return "Set it up on the computer you first signed in on: it holds your person key."
}

export function RecoveryKey({ recovery }: { recovery: RecoveryState }) {
  const { app } = useApp()
  const [step, setStep] = useState<Step | null>(null)
  const [renew, setRenew] = useState(false)
  const [cancelling, setCancelling] = useState(SHOT === "settings-recovery-cancel")
  const { recoveryWords } = app.actions

  useEffect(() => {
    if (SHOT !== "settings-recovery-words" && SHOT !== "settings-recovery-check") return
    void recoveryWords().then((words) => {
      if (!words) return
      setStep(SHOT === "settings-recovery-check" ? { ...checking(words), typed: [words[3] ?? "", "", ""] } : { at: "words", words })
    })
  }, [recoveryWords])

  const start = async () => {
    const words = await recoveryWords()
    if (words) setStep({ at: "words", words })
  }
  const close = () => {
    setStep(null)
    app.actions.recoveryDrop()
  }
  const save = async (s: Extract<Step, { at: "check" }>) => {
    if (s.busy || s.typed.some((t) => !t.trim())) return
    setStep({ ...s, busy: true })
    const r = await app.actions.recoverySave(s.ask.map((at, i) => ({ at, word: s.typed[i] ?? "" })))
    if (r?.ok) return setStep(null)
    setStep({ ...s, busy: false, wrong: r ? r.wrong : [] })
  }

  return (
    <section className="set-group" aria-label="Recovery key">
      <div className="heading">
        <h3>Recovery key</h3>
      </div>
      <p className="set-group-hint">24 words on paper, and the only way back to your account if you lose every computer. Keep them safe and offline.</p>
      <div className={recovery.at ? "set-rows" : "set-rows set-recovery-nudge"}>
        <Row label={recovery.at ? `Set up ${day(recovery.at)}` : "Not set up yet"} hint={hintFor(recovery)}>
          {recovery.here &&
            (recovery.at ? (
              <button type="button" className="btn is-quiet is-small" onClick={() => setRenew(true)}>
                New words
              </button>
            ) : (
              <button type="button" className="btn is-primary is-small" onClick={() => void start()}>
                Set up
              </button>
            ))}
        </Row>
        {recovery.pending && (
          <Row label={`New words take over ${day(recovery.pending.from)}`} hint={`Made by ${recovery.pending.by}. Until then your current words still work.`}>
            <button type="button" className="btn is-danger is-small" onClick={() => setCancelling(true)}>
              Not you? Cancel
            </button>
          </Row>
        )}
      </div>

      <Confirm
        open={renew}
        title="Make new words?"
        sub="Your old words stop working as soon as you've checked the new ones. Do this if the paper is lost or someone else saw it."
        action="Make new words"
        onClose={() => setRenew(false)}
        onConfirm={() => {
          setRenew(false)
          void start()
        }}
      />

      <Dialog open={!!step} onClose={close} label="Set up a recovery key" wide>
        {step?.at === "words" && (
          <>
            <DialogHead
              title="Write down these 24 words"
              sub="These words are the only way back to your account: once you've checked them, this computer lets go of your person key. Write them on paper, in order, and keep them safe and offline. Anyone with them can take over your account, so never type them into a website."
              onClose={close}
            />
            <div className="set-confirm">
              <ol className="set-words">
                {step.words.map((w, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {w}
                  </li>
                ))}
              </ol>
              <div className="dialog-foot">
                <button type="button" className="btn is-quiet" onClick={close}>
                  Cancel
                </button>
                <button type="button" className="btn is-primary" autoFocus onClick={() => setStep(checking(step.words))}>
                  I wrote them down
                </button>
              </div>
            </div>
          </>
        )}
        {step?.at === "check" && (
          <>
            <DialogHead title="Check three of them" sub={`Type words ${listed(step.ask)} from your paper.`} onClose={close} />
            <form
              className="set-confirm"
              onSubmit={(e) => {
                e.preventDefault()
                void save(step)
              }}
            >
              <div className="set-word-checks">
                {step.ask.map((at, i) => (
                  <Field key={at} label={`Word ${at + 1}`} hint={step.wrong.includes(at) ? `That isn't word ${at + 1}.` : undefined}>
                    <input
                      className="input is-mono"
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      autoFocus={i === 0}
                      value={step.typed[i] ?? ""}
                      aria-invalid={step.wrong.includes(at)}
                      onChange={(e) => setStep({ ...step, typed: step.typed.map((t, j) => (j === i ? e.target.value : t)), wrong: step.wrong.filter((w) => w !== at) })}
                    />
                  </Field>
                ))}
              </div>
              <div className="dialog-foot">
                <button type="button" className="btn is-quiet" onClick={() => setStep({ at: "words", words: step.words })}>
                  Show the words again
                </button>
                <button type="submit" className="btn is-primary" disabled={step.busy || step.typed.some((t) => !t.trim())}>
                  Set up
                </button>
              </div>
            </form>
          </>
        )}
      </Dialog>

      <Dialog open={cancelling} onClose={() => setCancelling(false)} label="Cancel the new words" wide>
        <WordsForm
          className="set-recover-cancel"
          title="Cancel with your current words"
          lede="Type the 24 words you have now, in order, or paste them all into the first box. The new words are dropped, and yours stay."
          action="Cancel the new words"
          busyLabel="Cancelling…"
          onSubmit={async (words) => {
            const trouble = await app.actions.recoveryCancel(words)
            if (!trouble) setCancelling(false)
            return trouble
          }}
          onCancel={() => setCancelling(false)}
        />
      </Dialog>
    </section>
  )
}
