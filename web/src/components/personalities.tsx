import { Dialog } from "@base-ui/react/dialog"
import { useState } from "react"

import { copyOf, freeId, PRESET_IDS } from "@kiwi/core/personalities.ts"
import { CAPABILITIES, MAX_AREA, MAX_AREAS, MAX_INSTRUCTIONS, MAX_NAME, ROLE_LABEL, ROLES, type Capability, type Personality } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { savePersonalities, useOwnPersonalities, usePersonalities } from "@/lib/personalities"
import { cx } from "@/lib/utils"
import { Button, Modal, TextField, errorText, toast } from "./kit"

const TAGLINE: Record<string, string> = {
  builder: "Takes a task to a merged PR",
  reviewer: "Reviews rounds; never codes the task it reviews",
  "bug-hunter": "Reproduces first, a failing test, then the fix",
  explorer: "Proposals and mockups; no code before a yes",
  releaser: "CI, builds and releases, under a lock",
  lead: "Keeps the board; one per channel",
}

const CAPABILITY_TEXT: Record<Capability, [string, string]> = {
  write: ["Write and ask", "Messages, questions, ask-human"],
  tasks: ["Work tasks", "Claim, update, finish its own"],
  prs: ["Open PRs", "One branch, one PR per task"],
  merge: ["Merge on green", "Squash-merge when ci-ok passes"],
  review: ["Review", "Approve or send back others' rounds"],
  release: ["Release", "Tags, builds, publishes"],
  assign: ["Assign work", "Hand tasks to others (the lead)"],
  notes: ["Set notes", "Channel facts"],
}

const BLANK: Omit<Personality, "id"> = { name: "New personality", glyph: "✳", role: "builder", capabilities: ["write", "tasks", "prs", "merge", "notes"], areas: [], instructions: "" }

function tagline(p: Personality): string {
  if (PRESET_IDS.has(p.id)) return TAGLINE[p.id] ?? ROLE_LABEL[p.role]
  return `${ROLE_LABEL[p.role]}${p.areas.length ? `, limited to ${p.areas.join(", ")}` : ""}`
}

function Tile({ glyph, size = 36 }: { glyph: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded-row border border-edge-strong text-body text-ink">
      {glyph}
    </span>
  )
}

function Row({ p, picked, onPick }: { p: Personality; picked: boolean; onPick: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-current={picked}
        onClick={onPick}
        className={cx("flex w-full items-start gap-3 rounded-ctl border px-3 py-2 text-left transition-colors", picked ? "border-accent" : "border-transparent hover:bg-wash")}
      >
        <Tile glyph={p.glyph} />
        <span className="min-w-0">
          <span className="block truncate text-ui font-semibold">{p.name}</span>
          <span className="line-clamp-2 block text-meta text-ink-3">{tagline(p)}</span>
        </span>
      </button>
    </li>
  )
}

function Editor({ p, onChange, onDuplicate, onDelete }: { p: Personality; onChange: (next: Personality) => void; onDuplicate: () => void; onDelete?: () => void }) {
  const preset = PRESET_IDS.has(p.id)
  const [name, setName] = useState(p.name)
  const [glyph, setGlyph] = useState(p.glyph)
  const [instructions, setInstructions] = useState(p.instructions)
  const [area, setArea] = useState("")
  const set = (patch: Partial<Personality>) => onChange({ ...p, ...patch })
  const toggle = (c: Capability) => set({ capabilities: CAPABILITIES.filter((x) => (x === c ? !p.capabilities.includes(c) : p.capabilities.includes(x))) })
  const addArea = () => {
    const a = area.trim()
    if (!a || a.length > MAX_AREA || p.areas.includes(a) || p.areas.length >= MAX_AREAS) return
    setArea("")
    set({ areas: [...p.areas, a] })
  }
  return (
    <section aria-label={`Edit ${p.name}`} className="flex min-w-0 flex-1 flex-col gap-5 p-5">
      <header className="flex items-start gap-3">
        {preset ? (
          <Tile glyph={p.glyph} size={44} />
        ) : (
          <input
            aria-label="Glyph"
            value={glyph}
            onChange={(e) => setGlyph(e.target.value)}
            onBlur={() => ([...glyph.trim()].length === 1 ? glyph.trim() !== p.glyph && set({ glyph: glyph.trim() }) : setGlyph(p.glyph))}
            className="size-11 shrink-0 rounded-row border border-edge-strong bg-transparent text-center text-title text-ink"
          />
        )}
        <div className="min-w-0 flex-1">
          {preset ? (
            <p className="text-display font-semibold">{p.name}</p>
          ) : (
            <TextField
              aria-label="Name"
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => (name.trim() ? name.trim() !== p.name && set({ name: name.trim() }) : setName(p.name))}
              className="text-title font-semibold"
            />
          )}
          <p className="mt-0.5 text-meta text-ink-3">{preset ? "Preset · edit it to make your own copy" : "Yours · kept on this computer"}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onDuplicate}>
          Duplicate
        </Button>
        {onDelete && (
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Delete
          </Button>
        )}
      </header>

      <div>
        <p className="mb-2 text-meta font-medium text-ink-2">Role · what it is for the board</p>
        <div role="radiogroup" aria-label="Role" className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={p.role === r}
              onClick={() => p.role !== r && set({ role: r })}
              className={cx("rounded-row border px-2.5 py-1 text-ui transition-colors", p.role === r ? "border-accent text-ink" : "border-edge-strong text-ink-2 hover:text-ink")}
            >
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-meta font-medium text-ink-2">Capabilities · what it may do, held by every member's client</p>
        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {CAPABILITIES.map((c) => (
            <label key={c} className="flex items-start gap-2.5">
              <input type="checkbox" checked={p.capabilities.includes(c)} onChange={() => toggle(c)} className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
              <span>
                <span className="block text-ui">{CAPABILITY_TEXT[c][0]}</span>
                <span className="block text-meta text-ink-3">{CAPABILITY_TEXT[c][1]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-meta font-medium text-ink-2">Areas · where it works, for routing</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {p.areas.length === 0 && <span className="rounded-row border border-edge-strong px-2.5 py-1 text-ui text-ink-2">Anywhere</span>}
          {p.areas.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`Remove ${a}`}
              onClick={() => set({ areas: p.areas.filter((x) => x !== a) })}
              className="rounded-row border border-edge-strong px-2.5 py-1 font-mono text-ui text-ink transition-colors hover:border-alert hover:text-alert"
            >
              {a} ×
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              addArea()
            }}
          >
            <input
              aria-label="Add an area"
              value={area}
              maxLength={MAX_AREA}
              onChange={(e) => setArea(e.target.value)}
              onBlur={addArea}
              placeholder="+ add a path, like web/"
              className="w-48 rounded-row border border-dashed border-edge-strong bg-transparent px-2.5 py-1 font-mono text-ui text-ink placeholder:text-ink-3"
            />
          </form>
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <label htmlFor="personality-instructions" className="mb-2 text-meta font-medium text-ink-2">
          Instructions · what the agent is told when it joins
        </label>
        <textarea
          id="personality-instructions"
          value={instructions}
          maxLength={MAX_INSTRUCTIONS}
          onChange={(e) => setInstructions(e.target.value)}
          onBlur={() => instructions !== p.instructions && set({ instructions })}
          className="min-h-40 flex-1 resize-none rounded-ctl border border-edge-strong bg-transparent p-3 text-ui leading-relaxed text-ink"
        />
      </div>
    </section>
  )
}

export function PersonalitiesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const own = useOwnPersonalities()
  const all = usePersonalities()
  const [pickedId, setPickedId] = useState<string>(PRESETS[0]!.id)
  const picked = all.find((p) => p.id === pickedId) ?? PRESETS[0]!
  const taken = new Set(all.map((p) => p.id))

  const save = (list: Personality[], pick?: string) =>
    savePersonalities(list).then(
      () => pick && setPickedId(pick),
      (err: unknown) => toast(`Not saved: ${errorText(err)}`, "error")
    )
  const change = (next: Personality) => {
    if (!PRESET_IDS.has(next.id)) return save(own.map((p) => (p.id === next.id ? next : p)))
    const mine = { ...copyOf(next, taken), name: `${next.name} (yours)`.slice(0, MAX_NAME) }
    return save([...own, mine], mine.id)
  }
  const duplicate = () => {
    const c = copyOf(picked, taken)
    return save([...own, c], c.id)
  }
  const create = () => {
    const id = freeId(BLANK.name, taken)
    return save([...own, { ...BLANK, id }], id)
  }
  const remove = () =>
    save(
      own.filter((p) => p.id !== picked.id),
      PRESETS[0]!.id
    )

  return (
    <Modal open={open} onClose={onClose} roomy>
      <div className="flex max-h-[88svh] flex-col md:h-[min(88svh,760px)] md:flex-row">
        <aside className="flex w-full shrink-0 flex-col gap-2 border-b border-line p-4 md:w-80 md:overflow-y-auto md:border-r md:border-b-0">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-title font-semibold">Personalities</Dialog.Title>
            <Button size="sm" variant="secondary" onClick={() => void create()}>
              New
            </Button>
          </div>
          <Dialog.Description className="text-meta text-ink-3">What an agent can be when you let it in: its role, what it may do, where it works, what it's told.</Dialog.Description>
          <p className="mt-2 text-meta font-medium text-ink-3">Presets for code work</p>
          <ul className="flex flex-col gap-0.5">
            {PRESETS.map((p) => (
              <Row key={p.id} p={p} picked={p.id === picked.id} onPick={() => setPickedId(p.id)} />
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-meta font-medium text-ink-3">Yours</p>
          {own.length ? (
            <ul aria-label="Yours" className="flex flex-col gap-0.5">
              {own.map((p) => (
                <Row key={p.id} p={p} picked={p.id === picked.id} onPick={() => setPickedId(p.id)} />
              ))}
            </ul>
          ) : (
            <p className="text-meta text-ink-3">None yet. Edit a preset or press New.</p>
          )}
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <Editor key={picked.id} p={picked} onChange={(n) => void change(n)} onDuplicate={() => void duplicate()} onDelete={PRESET_IDS.has(picked.id) ? undefined : () => void remove()} />
          <div className="flex justify-end border-t border-line px-5 py-3">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
