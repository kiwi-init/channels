import "~/styles/personalities.css"

import { useEffect, useRef, useState } from "react"

import { copyOf, freeId } from "@kiwi/core/personalities.ts"
import { CAPABILITIES, MAX_AREA, MAX_AREAS, MAX_INSTRUCTIONS, MAX_NAME, ROLE_LABEL, ROLES, type Capability, type Personality, type Role } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { Toggle } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { useApp } from "~/nav"
import { Confirm, Group, Row, Seg } from "~/settings/controls"

const TAGLINE: Record<string, string> = {
  builder: "Takes a task from start to done",
  reviewer: "Reviews rounds; never codes the task it reviews",
  "bug-hunter": "Reproduces first, a failing test, then the fix",
  explorer: "Proposals and mockups; no code before a yes",
  releaser: "CI, builds and releases, under a lock",
  lead: "Keeps the board; one per channel",
}

const CAPABILITY_TEXT: Record<Capability, readonly [string, string]> = {
  write: ["Write and ask", "Messages, questions, ask-human"],
  tasks: ["Work tasks", "Claim, update, finish its own"],
  prs: ["Open PRs", "The repo's own way"],
  merge: ["Merge PRs", "When the project's checks allow"],
  review: ["Review", "Approve or send back others' rounds"],
  release: ["Release", "Tags, builds, publishes"],
  assign: ["Assign work", "Hand tasks to others (the lead)"],
  notes: ["Set notes", "Channel facts"],
}

const ROLE_OPTIONS = ROLES.map((r) => [r, ROLE_LABEL[r]] as const) satisfies readonly (readonly [Role, string])[]

const BLANK: Omit<Personality, "id"> = { name: "New personality", glyph: "✳", role: "builder", capabilities: ["write", "tasks", "notes"], areas: [], instructions: "" }

const SHOT = new URLSearchParams(location.search).get("shot")

const tagline = (p: Personality): string => TAGLINE[p.id] ?? `${ROLE_LABEL[p.role]}${p.areas.length ? `, limited to ${p.areas.join(", ")}` : ""}`

export function Personalities() {
  const { app } = useApp()
  const own = app.ownPersonalities
  const taken = new Set([...PRESETS, ...own].map((p) => p.id))
  const copy = (p: Personality): Personality => ({ ...copyOf(p, taken), name: `${p.name} (yours)`.slice(0, MAX_NAME) })
  const [draft, setDraft] = useState<Personality | null>(() => (SHOT === "personality-editor" && PRESETS[0] ? copy(PRESETS[0]) : null))

  if (draft) return <Editor key={draft.id} start={draft} isNew={!own.some((p) => p.id === draft.id)} onDone={() => setDraft(null)} />
  return (
    <>
      <Group title="Personalities" hint="What an agent can be when you let it in: its role, what it may do, where it works, what it's told.">
        {PRESETS.map((p) => (
          <Row key={p.id} label={p.name} hint={tagline(p)}>
            <button type="button" className="btn is-quiet is-small" aria-label={`Copy ${p.name}`} onClick={() => setDraft(copy(p))}>
              Copy
            </button>
          </Row>
        ))}
      </Group>
      <Group title="Yours" hint="Kept on this computer.">
        {own.map((p) => (
          <Row
            key={p.id}
            label={
              <span className="persona-name">
                <span className="persona-glyph" aria-hidden="true">
                  {p.glyph}
                </span>
                {p.name}
              </span>
            }
            hint={tagline(p)}
          >
            <button type="button" className="btn is-quiet is-small" aria-label={`Edit ${p.name}`} onClick={() => setDraft(p)}>
              Edit
            </button>
          </Row>
        ))}
        <button type="button" className="set-row set-add" onClick={() => setDraft({ ...BLANK, id: freeId(BLANK.name, taken) })}>
          <Icon name="plus" size={14} />
          New personality
        </button>
      </Group>
    </>
  )
}

function Editor({ start, isNew, onDone }: { start: Personality; isNew: boolean; onDone: () => void }) {
  const { app } = useApp()
  const [draft, setDraft] = useState(start)
  const [area, setArea] = useState("")
  const [deleting, setDeleting] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  const own = app.ownPersonalities
  const set = (patch: Partial<Personality>) => setDraft((d) => ({ ...d, ...patch }))
  const toggle = (c: Capability) => set({ capabilities: CAPABILITIES.filter((x) => (x === c ? !draft.capabilities.includes(c) : draft.capabilities.includes(x))) })
  const addArea = () => {
    const a = area.trim()
    if (!a || draft.areas.includes(a) || draft.areas.length >= MAX_AREAS) return
    setArea("")
    set({ areas: [...draft.areas, a] })
  }

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" })
  }, [])

  return (
    <form
      ref={ref}
      className="persona-editor"
      aria-label={isNew ? "New personality" : `Edit ${start.name}`}
      onSubmit={(e) => {
        e.preventDefault()
        const glyph = [...draft.glyph.trim()].length === 1 ? draft.glyph.trim() : start.glyph
        const next = { ...draft, name: draft.name.trim() || start.name, glyph }
        app.actions.savePersonalities(isNew ? [...own, next] : own.map((p) => (p.id === next.id ? next : p)))
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || deleting) return
        e.preventDefault()
        onDone()
      }}
    >
      <div className="persona-head">
        <h3 className="persona-title">{isNew ? "New personality" : "Edit personality"}</h3>
        <p className="persona-hint">Kept on this computer. An agent takes it when you let it in.</p>
      </div>
      <div className="persona-form">
        <label className="persona-field is-glyph">
          <span className="persona-label">Glyph</span>
          <input className="input" value={draft.glyph} onChange={(e) => set({ glyph: e.target.value })} />
        </label>
        <label className="persona-field">
          <span className="persona-label">Name</span>
          <input className="input" autoFocus value={draft.name} maxLength={MAX_NAME} onChange={(e) => set({ name: e.target.value })} />
        </label>
      </div>
      <div className="persona-field">
        <span className="persona-label">Role · what it is for the board</span>
        <Seg label="Role" value={draft.role} options={ROLE_OPTIONS} onChange={(role) => set({ role })} />
      </div>
      <div className="persona-field">
        <span className="persona-label">Capabilities · what it may do, held by every member's client</span>
        <div className="set-rows">
          {CAPABILITIES.map((c) => (
            <Row key={c} label={CAPABILITY_TEXT[c][0]} hint={CAPABILITY_TEXT[c][1]}>
              <Toggle label={CAPABILITY_TEXT[c][0]} on={draft.capabilities.includes(c)} onChange={() => toggle(c)} />
            </Row>
          ))}
        </div>
      </div>
      <div className="persona-field">
        <span className="persona-label">Areas · where it works, for routing</span>
        <div className="persona-areas">
          {draft.areas.length === 0 && <span className="persona-area is-any">Anywhere</span>}
          {draft.areas.map((a) => (
            <button key={a} type="button" className="persona-area" aria-label={`Remove ${a}`} onClick={() => set({ areas: draft.areas.filter((x) => x !== a) })}>
              {a}
              <Icon name="close" size={12} />
            </button>
          ))}
          <input
            className="input persona-area-add"
            aria-label="Add an area"
            placeholder="Add a path, like web/"
            value={area}
            maxLength={MAX_AREA}
            onChange={(e) => setArea(e.target.value)}
            onBlur={addArea}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return
              e.preventDefault()
              addArea()
            }}
          />
        </div>
      </div>
      <label className="persona-field">
        <span className="persona-label">Instructions · what the agent is told when it joins</span>
        <textarea className="textarea persona-instructions" value={draft.instructions} maxLength={MAX_INSTRUCTIONS} onChange={(e) => set({ instructions: e.target.value })} />
      </label>
      <div className="persona-foot">
        {!isNew && (
          <button type="button" className="btn is-danger is-small" onClick={() => setDeleting(true)}>
            Delete personality
          </button>
        )}
        <span className="persona-foot-gap" />
        <button type="button" className="btn is-quiet" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn is-primary">
          Save personality
        </button>
      </div>
      <Confirm
        open={deleting}
        title="Delete this personality?"
        sub="It goes away on this computer."
        action="Delete personality"
        onClose={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false)
          app.actions.savePersonalities(own.filter((p) => p.id !== start.id))
          onDone()
        }}
      />
    </form>
  )
}
