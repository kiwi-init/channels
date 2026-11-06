import { useState } from "react"

import type { ModSettingValue, ModSettingView } from "../../../desktop/src/bridge.ts"
import { Toggle } from "~/kit/form"
import { modReads } from "~/mods/served"
import { useApp } from "~/nav"
import { Group, InlineEdit, Row } from "~/settings/controls"

function SecretEdit({ label, set, onSave }: { label: string; set: boolean; onSave: (value: string | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null)
    return (
      <span className="set-inline">
        <button type="button" className="btn is-quiet is-small" onClick={() => setDraft("")}>
          {set ? "Replace" : "Set"}
        </button>
        {set && (
          <button type="button" className="btn is-quiet is-small set-forget" onClick={() => onSave(null)}>
            Clear
          </button>
        )}
      </span>
    )
  return (
    <form
      className="set-inline"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft) onSave(draft)
        setDraft(null)
      }}
    >
      <input
        autoFocus
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="input is-mono set-inline-input"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return
          e.preventDefault()
          e.stopPropagation()
          setDraft(null)
        }}
      />
      <button type="submit" className="btn is-small" disabled={!draft}>
        Save
      </button>
      <button type="button" className="btn is-quiet is-small" onClick={() => setDraft(null)}>
        Cancel
      </button>
    </form>
  )
}

function hintOf(s: ModSettingView): string | undefined {
  const empty = s.type === "secret" ? !s.set : s.value === null || s.value === undefined || s.value === ""
  if (s.type === "secret")
    return s.set ? "Saved, sealed on this computer. Only this mod gets it." : s.required ? "Required. Sealed on this computer once saved." : "Sealed on this computer once saved."
  return s.required && empty ? "Required" : undefined
}

export function ModSettings({ mod, list }: { mod: string; list: readonly ModSettingView[] }) {
  const { toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const save = (id: string, value: ModSettingValue) => {
    const set = modReads().setModSetting
    if (!set) return
    setBusy(id)
    set(mod, id, value).then(
      () => setBusy(null),
      (e: unknown) => {
        setBusy(null)
        toast(e instanceof Error ? e.message : String(e), "error")
      }
    )
  }
  return (
    <Group title="Settings">
      {list.map((s) => (
        <Row key={s.id} label={s.title} hint={hintOf(s)}>
          {s.type === "toggle" ? (
            <Toggle on={s.value === true} label={s.title} disabled={busy === s.id} onChange={(on) => save(s.id, on)} />
          ) : s.type === "choice" ? (
            <select className="input" aria-label={s.title} disabled={busy === s.id} value={typeof s.value === "string" ? s.value : ""} onChange={(e) => save(s.id, e.target.value || null)}>
              {(!s.required || typeof s.value !== "string") && <option value="">{s.required ? "Pick one" : "None"}</option>}
              {(s.choices ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : s.type === "secret" ? (
            <SecretEdit label={s.title} set={!!s.set} onSave={(v) => save(s.id, v)} />
          ) : (
            <>
              <InlineEdit value={typeof s.value === "string" ? s.value : ""} label={s.title} verb={typeof s.value === "string" && s.value ? "Change" : "Set"} onSave={(v) => save(s.id, v)} />
              {!s.required && typeof s.value === "string" && s.value && (
                <button type="button" className="btn is-quiet is-small" onClick={() => save(s.id, null)}>
                  Clear
                </button>
              )}
            </>
          )}
        </Row>
      ))}
    </Group>
  )
}
