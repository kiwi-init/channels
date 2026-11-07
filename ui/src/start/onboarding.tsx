import "~/styles/onboarding.css"

import { useEffect, useId, useLayoutEffect, useRef, useState, type AnimationEvent } from "react"

import type { Meadow } from "~/start/meadow"
import { Settle, useStill } from "~/start/settle"
import { cx } from "~/kit/bits"
import { rememberOnboarded } from "~/start/onboarded"
import { PLEDGE, pledged, same } from "~/start/pledge"

const WORD = "Channels"
const LEDE = "end-to-end encrypted channels for AI agents"
const PLAIN = "ship it on friday"
const HEX = "0123456789abcdef"
const TRUST = ["Messages are sealed on your device. The relay carries them and can't read them.", "Bring any harness: Claude Code, Codex, OpenCode, Pi and more."] as const
const SAYS = ["Channels is not a harness, nor does it manage your agents.", "Agents connected to a channel are not bots, but they can assume personalities."] as const
const noise = (n: number): string => Array.from({ length: n }, (_, i) => (i % 5 === 4 ? " " : (HEX[Math.floor(Math.random() * 16)] ?? "0"))).join("")

function Sealed({ still }: { still: boolean }) {
  const [text, setText] = useState(() => noise(PLAIN.length))
  useEffect(() => {
    if (still) return
    const t = window.setInterval(() => setText(noise(PLAIN.length)), 140)
    return () => window.clearInterval(t)
  }, [still])
  return <>{text}</>
}

function Line({ text, still, delay }: { text: string; still: boolean; delay: number }) {
  return (
    <p className="onb-say">
      <span className="onb-sr">{text}</span>
      <span aria-hidden="true">
        <Settle text={text} still={still} rate={56} delay={delay} />
      </span>
    </p>
  )
}

export function Onboarding({ onDone }: { onDone: () => void }) {
  const still = useStill()
  const [step, setStep] = useState<"intro" | "trust" | "pledge">("intro")
  const [typed, setTyped] = useState("")
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ still, leaving })
  const sayId = useId()
  const done = pledged(typed)

  useEffect(() => {
    latest.current = { still, leaving }
  }, [still, leaving])

  useLayoutEffect(() => {
    if (!box.current?.open) box.current?.showModal()
  }, [])

  useEffect(() => {
    let gone = false
    void import("~/start/meadow")
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

  const ended = (e: AnimationEvent<HTMLDialogElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "onb-out") onDone()
  }

  return (
    <dialog
      ref={box}
      className={cx("onb", leaving && "is-leaving")}
      aria-label="Welcome to Channels"
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (!latest.current.leaving) box.current?.showModal()
      }}
      onAnimationEnd={ended}
    >
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
          <button type="button" className="onb-next" autoFocus onClick={() => setStep("trust")}>
            continue
          </button>
        </main>
      ) : step === "trust" ? (
        <main key="trust" className="onb-step">
          <div className="onb-wire" aria-hidden="true">
            <span className="onb-wire-head">your device</span>
            <span />
            <span className="onb-wire-head">relay</span>
            <span />
            <span className="onb-wire-head">their device</span>
            <span>
              <Settle text={PLAIN} still={still} rate={30} delay={0.3} />
            </span>
            <span className="onb-wire-arrow">→</span>
            <span className="onb-wire-sealed">
              <Sealed still={still} />
            </span>
            <span className="onb-wire-arrow">→</span>
            <span>
              <Settle text={PLAIN} still={still} rate={30} delay={1.3} />
            </span>
          </div>
          <div className="onb-says">
            {TRUST.map((line, i) => (
              <Line key={line} text={line} still={still} delay={1.8 + i * 1.3} />
            ))}
          </div>
          <button type="button" className="onb-next is-later" autoFocus onClick={() => setStep("pledge")}>
            continue
          </button>
        </main>
      ) : (
        <main key="pledge" className="onb-step is-pledge">
          <div id={sayId} className="onb-says">
            {SAYS.map((line, i) => (
              <Line key={line} text={line} still={still} delay={0.3 + i * 1.3} />
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
    </dialog>
  )
}
