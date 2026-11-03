import { useEffect, useState } from "react"

import { Dialog } from "~/kit/bits"
import type { RerootDevice } from "~/model"
import { useApp } from "~/nav"
import { WordsForm } from "~/start/recover"

const SHOT = new URLSearchParams(location.search).get("shot")

const KIND: Record<RerootDevice["as"], string> = { desktop: "computer", phone: "phone", computer: "computer for agents" }

type Step = { at: "words" } | { at: "keep"; devices: RerootDevice[]; keep: Set<string>; busy: boolean }

function Keep({ step, onStep, onBack }: { step: Extract<Step, { at: "keep" }>; onStep: (s: Step | null) => void; onBack: () => void }) {
  const { app } = useApp()
  const dropped = step.devices.filter((d) => !d.here && !step.keep.has(d.id)).length
  const flip = (id: string) => {
    const keep = new Set(step.keep)
    if (keep.has(id)) keep.delete(id)
    else keep.add(id)
    onStep({ ...step, keep })
  }
  const finish = async () => {
    if (step.busy) return
    onStep({ ...step, busy: true })
    const done = await app.actions.rerootFinish([...step.keep])
    onStep(done ? null : { ...step, busy: false })
  }

  return (
    <form
      className="set-recover-cancel"
      onSubmit={(e) => {
        e.preventDefault()
        void finish()
      }}
    >
      <h1 className="start-word">Keep which devices?</h1>
      <p className="start-lede">Untick the ones you don't know or no longer have. They're signed out.</p>
      <ul className="recover-devices set-reroot-devices">
        {step.devices.map((d) => (
          <li key={d.id}>
            <label className="recover-device">
              <input type="checkbox" checked={d.here || step.keep.has(d.id)} disabled={d.here || step.busy} onChange={() => flip(d.id)} />
              <span className="recover-device-name">{d.label}</span>
              <span className="recover-device-kind">
                {d.here ? "this computer" : KIND[d.as]}
                {d.os ? ` · ${d.os}` : ""}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="start-hint">Your old person key stops working everywhere. Your words stay the same.</p>
      <div className="recover-foot">
        <button type="button" className="btn is-quiet" disabled={step.busy} onClick={onBack}>
          Cancel
        </button>
        <button type="submit" className="btn is-danger" disabled={step.busy}>
          {step.busy ? "Replacing…" : dropped ? `Replace and sign out ${dropped}` : "Replace the key"}
        </button>
      </div>
    </form>
  )
}

export function Reroot({ onClose }: { onClose: () => void }) {
  const { app } = useApp()
  const [step, setStep] = useState<Step>({ at: "words" })

  useEffect(() => {
    if (SHOT !== "settings-reroot-keep") return
    void app.actions.rerootOpen(Array.from({ length: 24 }, () => "orbit").join(" ")).then((r) => {
      if (r?.ok) setStep({ at: "keep", devices: r.devices, keep: new Set(r.devices.map((d) => d.id)), busy: false })
    })
  }, [app.actions])

  const close = () => {
    if (step.at === "keep" && step.busy) return
    app.actions.rerootCancel()
    onClose()
  }

  return (
    <Dialog open onClose={close} label="Replace your person key" wide>
      {step.at === "words" && (
        <WordsForm
          className="set-recover-cancel"
          title="Replace your person key"
          lede="Type your 24 words, or paste them all at once."
          action="Next"
          busyLabel="Opening…"
          onSubmit={async (words) => {
            const r = await app.actions.rerootOpen(words)
            if (!r) return null
            if (!r.ok) return r.trouble
            setStep({ at: "keep", devices: r.devices, keep: new Set(r.devices.map((d) => d.id)), busy: false })
            return null
          }}
          onCancel={close}
          back="Not now"
        />
      )}
      {step.at === "keep" && (
        <Keep
          step={step}
          onStep={(s) => {
            if (s) return setStep(s)
            onClose()
          }}
          onBack={close}
        />
      )}
    </Dialog>
  )
}
