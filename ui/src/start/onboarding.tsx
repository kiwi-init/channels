import "~/i18n/en/shell-later"
import "~/styles/onboarding.css"

import { useEffect, useLayoutEffect, useRef, useState, type AnimationEvent } from "react"

import type { Meadow } from "~/meadow/meadow"
import { Settle, useStill } from "~/meadow/settle"
import { cx } from "~/kit/bits"
import { rememberOnboarded } from "~/start/onboarded"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"

const WORD = "Channels"
const SCENE_WAIT_MS = 4000
const HEX = "0123456789abcdef"
const TRUST: readonly Key[] = ["start.onboarding.trust.sealed"]
const noise = (n: number): string => Array.from({ length: n }, (_, i) => (i % 5 === 4 ? " " : (HEX[Math.floor(Math.random() * 16)] ?? "0"))).join("")

function Sealed({ still, length }: { still: boolean; length: number }) {
  const [text, setText] = useState(() => noise(length))
  useEffect(() => {
    if (still) return
    const timer = window.setInterval(() => setText(noise(length)), 140)
    return () => window.clearInterval(timer)
  }, [still, length])
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
  const [step, setStep] = useState<"intro" | "trust">("intro")
  const [leaving, setLeaving] = useState(false)
  const [ready, setReady] = useState(false)
  const box = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ still, leaving })
  const lede = t("start.onboarding.lede")
  const plain = t("start.onboarding.plain")

  useEffect(() => {
    latest.current = { still, leaving }
  }, [still, leaving])

  useLayoutEffect(() => {
    if (!box.current?.open) box.current?.showModal()
  }, [])

  useEffect(() => {
    let gone = false
    const arrive = () => requestAnimationFrame(() => requestAnimationFrame(() => !gone && setReady(true)))
    const late = window.setTimeout(arrive, SCENE_WAIT_MS)
    void import("~/meadow/meadow")
      .then(({ startMeadow }) => {
        if (gone || !stage.current) return null
        return startMeadow(stage.current, latest.current.still)
      })
      .then((m) => {
        arrive()
        if (!m) return
        if (gone) return m.dispose()
        meadow.current = m
        if (latest.current.leaving) m.freeze()
      })
      .catch(() => {
        // Without the scene the haze stays behind the words, and they still read.
        arrive()
      })
    return () => {
      gone = true
      window.clearTimeout(late)
      meadow.current?.dispose()
      meadow.current = null
    }
  }, [])

  useEffect(() => meadow.current?.setStill(still), [still])

  const begin = (): void => {
    rememberOnboarded()
    setLeaving(true)
  }

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
      aria-label={t("start.onboarding.welcome")}
      onCancel={(e) => e.preventDefault()}
      onClose={() => {
        if (!latest.current.leaving) box.current?.showModal()
      }}
      onAnimationEnd={ended}
    >
      <div className="onb-drag" />
      <div ref={stage} className={cx("onb-back", ready && "is-in")} aria-hidden="true" />
      {ready && <div className="onb-shade" aria-hidden="true" />}
      {!ready ? null : step === "intro" ? (
        <main key="intro" className="onb-step">
          <h1 className="onb-word">
            <span className="onb-sr">{WORD}</span>
            <span aria-hidden="true">
              <Settle text={WORD} still={still} rate={10} delay={0.4} />
            </span>
          </h1>
          <p className="onb-lede">
            <span className="onb-sr">{lede}</span>
            <span aria-hidden="true">
              <Settle text={lede} still={still} rate={48} delay={1.4} />
            </span>
          </p>
          <button type="button" className="onb-next" autoFocus onClick={() => setStep("trust")}>
            {t("start.onboarding.continue")}
          </button>
        </main>
      ) : (
        <main key="trust" className="onb-step">
          <div className="onb-wire" aria-hidden="true">
            <span className="onb-wire-head">{t("start.onboarding.your.device")}</span>
            <span />
            <span className="onb-wire-head">{t("start.onboarding.relay")}</span>
            <span />
            <span className="onb-wire-head">{t("start.onboarding.their.device")}</span>
            <span>
              <Settle text={plain} still={still} rate={30} delay={0.3} />
            </span>
            <span className="onb-wire-arrow">→</span>
            <span className="onb-wire-sealed">
              <Sealed still={still} length={plain.length} />
            </span>
            <span className="onb-wire-arrow">→</span>
            <span>
              <Settle text={plain} still={still} rate={30} delay={1.3} />
            </span>
          </div>
          <div className="onb-says">
            {TRUST.map((line, i) => (
              <Line key={line} text={t(line)} still={still} delay={1.8 + i * 1.3} />
            ))}
          </div>
          <button type="button" className="onb-next is-later" autoFocus onClick={begin}>
            {t("start.onboarding.continue")}
          </button>
        </main>
      )}
    </dialog>
  )
}
