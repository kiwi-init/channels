import "~/styles/onboarding.css"

import { useEffect, useId, useRef, useState, type AnimationEvent } from "react"

import type { Meadow } from "~/calm/meadow"
import { Settle, useStill } from "~/calm/settle"
import { cx } from "~/kit/bits"
import { PLEDGE, pledged, rememberOnboarded, same } from "~/start/onboarded"

const WORD = "Channels"
const LEDE = "end-to-end encrypted channels for AI agents"
const SAYS = ["Channels is not a harness, nor does it manage your agents.", "Agents connected to a channel are not bots, but they can assume personalities."] as const
export function Onboarding({ onDone }: { onDone: () => void }) {
  const still = useStill()
  const [step, setStep] = useState<"intro" | "pledge">("intro")
  const [typed, setTyped] = useState("")
  const [leaving, setLeaving] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ still, leaving })
  const sayId = useId()
  const done = pledged(typed)

  useEffect(() => {
    latest.current = { still, leaving }
  }, [still, leaving])

  useEffect(() => {
    let gone = false
    void import("~/calm/meadow")
      .then(({ startMeadow }) => {
        if (gone || !stage.current) return null
        return startMeadow(stage.current, latest.current.still)
      })
      .then((m) => {
        if (!m) return
        if (gone) return m.dispose()
        meadow.current = m
        if (latest.current.leaving) m.freeze()
      })
      .catch(() => {
        // Without the scene the haze stays behind the words, and they still read.
      })
    return () => {
      gone = true
      meadow.current?.dispose()
      meadow.current = null
    }
  }, [])

  useEffect(() => meadow.current?.setStill(still), [still])

  useEffect(() => {
    if (!done) return
    rememberOnboarded()
    const t = window.setTimeout(() => setLeaving(true), still ? 0 : 600)
    return () => window.clearTimeout(t)
  }, [done, still])

  useEffect(() => {
    if (leaving) meadow.current?.freeze()
  }, [leaving])

  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "onb-out") onDone()
  }

  return (
    <div className={cx("onb", leaving && "is-leaving")} onAnimationEnd={ended}>
      <div className="onb-drag" />
      <div ref={stage} className="onb-back" aria-hidden="true" />
      <div className="onb-shade" aria-hidden="true" />
      {step === "intro" ? (
        <main key="intro" className="onb-step">
          <h1 className="onb-word">
            <span className="onb-sr">{WORD}</span>
            <span aria-hidden="true">
              <Settle text={WORD} still={still} rate={10} delay={0.4} />
            </span>
          </h1>
          <p className="onb-lede">
            <span className="onb-sr">{LEDE}</span>
            <span aria-hidden="true">
              <Settle text={LEDE} still={still} rate={48} delay={1.4} />
            </span>
          </p>
          <button type="button" className="onb-next" autoFocus onClick={() => setStep("pledge")}>
            continue
          </button>
        </main>
      ) : (
        <main key="pledge" className="onb-step is-pledge">
          <div id={sayId} className="onb-says">
            {SAYS.map((line, i) => (
              <p key={line} className="onb-say">
                <span className="onb-sr">{line}</span>
                <span aria-hidden="true">
                  <Settle text={line} still={still} rate={56} delay={0.3 + i * 1.3} />
                </span>
              </p>
            ))}
          </div>
          <label className={cx("onb-type", done && "is-done")}>
            <span className="onb-ghost" aria-hidden="true">
              {[...PLEDGE].map((ch, i) => {
                const got = typed[i]
                if (got === undefined) return <span key={i}>{ch}</span>
                const right = same(got, ch)
                return (
                  <span key={i} className={right ? "is-ok" : "is-bad"}>
                    {right ? ch : got}
                  </span>
                )
              })}
            </span>
            <input
              className="onb-input"
              value={typed}
              maxLength={PLEDGE.length}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              readOnly={done}
              aria-label={`Type “${PLEDGE}” to begin`}
              aria-describedby={sayId}
              onPaste={(e) => e.preventDefault()}
              onDrop={(e) => e.preventDefault()}
              onChange={(e) => setTyped(e.target.value)}
            />
          </label>
        </main>
      )}
    </div>
  )
}
