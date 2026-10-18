import { Dialog } from "@base-ui/react/dialog"

import { setAppearance, setTextSize, useAppearance, useTextSize, type Appearance, type TextSize } from "@/lib/theme"
import { setAccessibilityOption, useAccessibilityOption } from "@/lib/accessibility"
import { cx } from "@/lib/utils"
import { useEffect, useState } from "react"
import { relayUrl } from "@/lib/relay"
import { bridge, useSecrets } from "@/lib/secrets"
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

type RelayBridge = { setRelayUrl?: (url: string) => Promise<string> }

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

function VoiceFields() {
  const b = bridge()
  const snap = useSecrets()
  const [key, setKey] = useState("")
  const [error, setError] = useState<string | null>(null)
  if (!b?.setVoiceKey) return null
  const fail = (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e))
  const save = () => {
    setError(null)
    b.setVoiceKey(key).catch(fail)
  }
  const clear = () => {
    setError(null)
    setKey("")
    b.setVoiceKey("").catch(fail)
  }
  const rooms = snap.channels.filter((c) => c.roomId)
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">Voice</p>
      <p className="mb-2 text-ui leading-normal text-ink-2">An xAI key lets this Mac talk with Grok Voice. Each channel stays off until you turn it on.</p>
      <label htmlFor="voice-key" className="mb-2 block text-ui font-medium text-ink">
        xAI key
      </label>
      <div className="flex gap-2">
        <input
          id="voice-key"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && save()}
          spellCheck={false}
          autoComplete="off"
          className="h-8 min-w-0 flex-1 rounded-row border border-line bg-transparent px-2 font-mono text-ui text-ink"
        />
        <Button variant="secondary" onClick={save} disabled={!key.trim()}>
          Save
        </Button>
        {snap.voice.configured && (
          <Button variant="secondary" onClick={clear}>
            Remove
          </Button>
        )}
      </div>
      {snap.voice.configured && <p className="mt-1 text-ui text-ink-2">A key is saved on this Mac.</p>}
      {rooms.length > 0 && (
        <div className="mt-4 grid gap-1">
          {rooms.map((c) => {
            const id = c.roomId
            if (!id) return null
            const on = snap.voice.consent[id] === true
            return (
              <label key={id} className="flex items-center gap-2 text-ui text-ink">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    setError(null)
                    b.setVoiceConsent(id, e.target.checked).catch(fail)
                  }}
                  className="size-4 accent-[var(--accent)]"
                />
                {c.name ?? c.label}
              </label>
            )
          })}
        </div>
      )}
      {error && (
        <p className="mt-1 text-ui text-ink-2" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function GithubFields() {
  const b = bridge()
  const [status, setStatus] = useState<{ available: boolean; account: { login: string } | null } | null>(null)
  const [code, setCode] = useState<{ code: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!b?.githubStatus) return
    void b.githubStatus().then(setStatus, () => setStatus(null))
    return b.onGithubCode(setCode)
  }, [b])
  if (!b?.githubStatus || !status || (!status.available && !status.account)) return null
  const run = (go: () => Promise<{ available: boolean; account: { login: string } | null }>) => {
    setError(null)
    setBusy(true)
    go()
      .then(setStatus, (e: unknown) => setError(e instanceof Error ? e.message.replace(/^.*?Error: /, "") : String(e)))
      .finally(() => (setBusy(false), setCode(null)))
  }
  return (
    <div>
      <p className="mb-2 text-ui font-medium text-ink">GitHub</p>
      <p className="mb-2 text-ui leading-normal text-ink-2">Link your account so what has to come from you, like approving a pull request, can. The token stays on this Mac; agents never get it.</p>
      {status.account ? (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-ui text-ink">Linked as @{status.account.login}</p>
          <Button variant="secondary" disabled={busy} onClick={() => run(b.githubUnlink)}>
            Unlink
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => run(b.githubLink)}>
            {busy ? "Waiting for GitHub…" : "Link GitHub"}
          </Button>
          {busy && code && (
            <p className="min-w-0 text-ui text-ink-2">
              Enter <span className="font-mono font-medium text-ink">{code.code}</span> at {code.url.replace(/^https:\/\//, "")}
            </p>
          )}
        </div>
      )}
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
          <GithubFields />
          <VoiceFields />
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
