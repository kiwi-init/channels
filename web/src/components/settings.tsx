import { Dialog } from "@base-ui/react/dialog"

import { setAppearance, setTextSize, useAppearance, useTextSize, type Appearance, type TextSize } from "@/lib/theme"
import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { cx } from "@/lib/utils"
import { useEffect, useState } from "react"
import { relayUrl } from "@/lib/relay"
import { version } from "../../../package.json"
import { Button, Modal, SEGMENTED, SEGMENT_OFF, SEGMENT_ON } from "./kit"

// How Channels looks in this browser: the theme and how large everything reads.
// Both apply at once and stay in this browser; nothing here leaves it.

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">{label}</p>
      <div role="radiogroup" aria-label={label} className={cx("grid gap-0.5", SEGMENTED)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx("h-7 rounded-row px-2 text-ui font-medium transition-colors", value === o.value ? SEGMENT_ON : SEGMENT_OFF)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

type RelayBridge = {
  setRelayUrl?: (url: string) => Promise<string>
  backupStatus?: () => Promise<{ at: number } | null>
  backupRun?: () => Promise<{ passphrase: string; at: number }>
}

// The relay this app talks to. Only the desktop app can change it; saving reloads the app on the new relay.
function RelayField() {
  const bridge = (window as unknown as { kiwi?: RelayBridge }).kiwi
  const [value, setValue] = useState(relayUrl())
  const [error, setError] = useState<string | null>(null)
  if (!bridge?.setRelayUrl) return null
  const save = () => {
    setError(null)
    bridge.setRelayUrl!(value.trim()).catch((e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
  }
  return (
    <div>
      <label htmlFor="relay-url" className="mb-2 block text-ui font-medium text-ink">
        Relay
      </label>
      <div className="flex gap-2">
        <input
          id="relay-url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-row border border-line bg-transparent px-2 font-mono text-ui text-ink"
        />
        <Button variant="secondary" onClick={save} disabled={value.trim() === relayUrl()}>
          Use
        </Button>
      </div>
      {error && (
        <p className="mt-1 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function BackupField() {
  const bridge = (window as unknown as { kiwi?: RelayBridge }).kiwi
  const [at, setAt] = useState<number | null>(null)
  const [words, setWords] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    bridge?.backupStatus?.().then(
      (s) => setAt(s?.at ?? null),
      () => {}
    )
  }, [bridge])
  if (!bridge?.backupRun) return null
  const run = () => {
    setBusy(true)
    setError(null)
    bridge.backupRun!().then(
      (r) => {
        setWords(r.passphrase)
        setAt(r.at)
        setBusy(false)
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
        setBusy(false)
      }
    )
  }
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">Account backup</p>
      <p className="mb-2 text-ui leading-normal text-ink-2">
        {at ? `Backed up ${new Date(at).toLocaleString()}.` : "Not backed up."} Lets you open your channels on your phone after signing in. Sealed under six words only you hold.
      </p>
      {words && (
        <p className="mb-2 select-all rounded-row border border-line p-2 font-mono text-ui text-ink" data-testid="backup-words">
          {words}
        </p>
      )}
      {words && <p className="mb-2 text-ui text-ink-2">Write these down now. They are shown once and Kiwi cannot recover them.</p>}
      <Button variant="secondary" onClick={run} disabled={busy}>
        {at ? "Back up again (new words)" : "Back up"}
      </Button>
      {error && (
        <p className="mt-1 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const appearance = useAppearance()
  const size = useTextSize()
  const reduceMotion = useAccessibilityOption("reduce-motion")
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <Dialog.Title className="text-title font-semibold tracking-[-0.01em]">Settings</Dialog.Title>
        <Dialog.Description className="mt-1 text-ui leading-normal text-ink-2">How Channels looks in this browser. Changes apply at once.</Dialog.Description>
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)] gap-5">
          <Choice<Appearance>
            label="Theme"
            value={appearance}
            onChange={setAppearance}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <Choice<TextSize>
            label="Text size"
            value={size}
            onChange={setTextSize}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
              { value: "larger", label: "Larger" },
            ]}
          />
          <Choice<"on" | "off">
            label="Motion"
            value={reduceMotion ? "on" : "off"}
            onChange={(v) => setAccessibilityOption("reduce-motion", v === "on")}
            options={[
              { value: "off", label: "Full" },
              { value: "on", label: "Reduced" },
            ]}
          />
          <RelayField />
          <BackupField />
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-ui text-ink-2">Channels {version}</p>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}
