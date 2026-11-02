import "~/styles/recover.css"

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react"

import { RECOVERY_WORDS } from "@kiwi/core/recovery-words.ts"
import { cx } from "~/kit/bits"
import type { Enrolling, RecoverDevice, RecoverTrouble } from "~/model"
import { useApp } from "~/nav"

const COUNT = 24
const KIND: Record<RecoverDevice["as"], string> = { desktop: "computer", phone: "phone", computer: "computer for agents" }

const wordsIn = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)

function completion(typed: string): string | null {
  const t = typed.trim().toLowerCase()
  if (t.length < 2) return null
  return RECOVERY_WORDS.find((w) => w.startsWith(t)) ?? null
}

export function WordsForm({
  className,
  title,
  lede,
  action,
  busyLabel,
  onSubmit,
  onCancel,
  back = "Cancel",
}: {
  className: string
  title: string
  lede: string
  action: string
  busyLabel: string
  onSubmit: (words: string) => Promise<RecoverTrouble | null>
  onCancel: () => void
  back?: string
}) {
  const [words, setWords] = useState<string[]>(() => Array.from({ length: COUNT }, () => ""))
  const [trouble, setTrouble] = useState<RecoverTrouble | null>(null)
  const [busy, setBusy] = useState(false)
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const filled = words.filter((w) => w.trim()).length

  const put = (at: number, value: string) => {
    setWords((ws) => ws.map((w, i) => (i === at ? value : w)))
    setTrouble(null)
  }

  const accept = (at: number): boolean => {
    const hit = completion(words[at]!)
    if (!hit || hit === words[at]!.trim().toLowerCase()) return false
    put(at, hit)
    return true
  }

  const onKey = (at: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === " " || (e.key === "Enter" && at < COUNT - 1)) {
      e.preventDefault()
      accept(at)
      boxes.current[at + 1]?.focus()
    } else if (e.key === "Tab" && !e.shiftKey) accept(at)
    else if (e.key === "Backspace" && !words[at] && at > 0) {
      e.preventDefault()
      boxes.current[at - 1]?.focus()
    }
  }

  const onPaste = (at: number, e: ClipboardEvent<HTMLInputElement>) => {
    const got = wordsIn(e.clipboardData.getData("text"))
    if (got.length < 2) return
    e.preventDefault()
    const from = got.length >= COUNT ? 0 : at
    setWords((ws) => ws.map((w, i) => (i >= from && i - from < got.length ? got[i - from]! : w)))
    setTrouble(null)
    boxes.current[Math.min(from + got.length, COUNT) - 1]?.focus()
  }

  const submit = () => {
    if (busy || filled < COUNT) return
    setBusy(true)
    void onSubmit(words.map((w) => w.trim()).join(" ")).then((t) => {
      setBusy(false)
      setTrouble(t)
      if (t?.word !== undefined) boxes.current[t.word]?.focus()
    })
  }

  return (
    <form
      className={className}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <h1 className="start-word">{title}</h1>
      <p className="start-lede">{lede}</p>
      <ol className="recover-words">
        {words.map((w, i) => {
          const hit = completion(w)
          const ghost = hit && w && hit.startsWith(w.toLowerCase()) ? hit.slice(w.length) : ""
          const wrong = trouble?.word === i || (w.length > 1 && !hit)
          return (
            <li key={i} className={cx("recover-word", wrong && "is-wrong")}>
              <span className="recover-n" aria-hidden="true">
                {i + 1}
              </span>
              <span className="recover-field">
                <input
                  ref={(el) => void (boxes.current[i] = el)}
                  className="recover-input"
                  aria-label={`Word ${i + 1}`}
                  aria-invalid={wrong || undefined}
                  autoFocus={i === 0}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={w}
                  onChange={(e) => put(i, e.target.value.replace(/[^a-z]/gi, "").toLowerCase())}
                  onKeyDown={(e) => onKey(i, e)}
                  onPaste={(e) => onPaste(i, e)}
                  onBlur={() => void accept(i)}
                />
                {ghost && (
                  <span className="recover-ghost" aria-hidden="true">
                    <span className="recover-typed">{w}</span>
                    {ghost}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
      <p className={cx("start-hint", trouble && "is-error")} aria-live="polite">
        {trouble ? `${trouble.why[0]!.toUpperCase()}${trouble.why.slice(1)}.` : filled < COUNT ? `${filled} of ${COUNT} words` : "All 24 words in."}
      </p>
      <div className="recover-foot">
        <button type="button" className="btn is-quiet" onClick={onCancel}>
          {back}
        </button>
        <button type="submit" className="btn is-primary" disabled={busy || filled < COUNT}>
          {busy ? busyLabel : action}
        </button>
      </div>
    </form>
  )
}

function Words() {
  const { app } = useApp()
  return (
    <div className="start-first-box start-recover">
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      <WordsForm
        className="recover-form"
        title="Use your recovery key"
        lede="Type the 24 words you wrote down, in order, or paste them all into the first box."
        action="Recover"
        busyLabel="Opening…"
        onSubmit={(words) => app.actions.recoverOpen(words)}
        onCancel={() => app.actions.enrollCancel()}
      />
    </div>
  )
}

function Welcome({ name, devices, channels }: { name: string; devices: RecoverDevice[]; channels: string[] }) {
  const { app } = useApp()
  const [lost, setLost] = useState<Set<string>>(() => new Set(devices.filter((d) => d.lost).map((d) => d.id)))
  const [busy, setBusy] = useState(false)
  const flip = (id: string) =>
    setLost((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const finish = () => {
    if (busy) return
    setBusy(true)
    void app.actions.recoverFinish([...lost]).finally(() => setBusy(false))
  }

  return (
    <form
      className="start-first-box start-recover"
      onSubmit={(e) => {
        e.preventDefault()
        finish()
      }}
    >
      <span className="start-mark">
        <img src="/icon.svg" width={40} height={40} alt="" />
      </span>
      <h1 className="start-word">Welcome back, {name}</h1>
      <p className="start-lede">Your recovery key opened. This computer joins as you when you continue.</p>
      {devices.length > 0 && (
        <>
          <p className="start-ask">Tick the devices you lost</p>
          <ul className="recover-devices">
            {devices.map((d) => (
              <li key={d.id}>
                <label className="recover-device">
                  <input type="checkbox" checked={lost.has(d.id)} onChange={() => flip(d.id)} />
                  <span className="recover-device-name">{d.label}</span>
                  <span className="recover-device-kind">
                    {KIND[d.as]}
                    {d.os ? ` · ${d.os}` : ""}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="start-hint">Ticked devices are forgotten: they can't read or post in your channels any more.</p>
        </>
      )}
      {channels.length > 0 && <p className="recover-back">Coming back: {channels.join(", ")}</p>}
      <div className="recover-foot">
        <button type="button" className="btn is-quiet" onClick={() => app.actions.enrollCancel()}>
          Cancel
        </button>
        <button type="submit" className="btn is-primary" disabled={busy} autoFocus>
          {busy ? "Joining…" : lost.size ? `Forget ${lost.size} and continue` : "Continue"}
        </button>
      </div>
    </form>
  )
}

export function Recover({ enrolling }: { enrolling: Extract<Enrolling, { stage: "recover" | "welcome" }> }) {
  return enrolling.stage === "recover" ? <Words /> : <Welcome name={enrolling.name} devices={enrolling.devices} channels={enrolling.channels} />
}
