import "~/styles/mods.css"

import { useState, type FormEvent } from "react"

import type { ModStart } from "../../../desktop/src/bridge.ts"
import { autofocus } from "~/kit/bits"
import { Field } from "~/kit/form"
import { Track } from "~/kit/glide"
import { Modal } from "~/kit/modal"
import { modReads } from "~/mods/served"
import { nickname, seatRoot } from "~/names"
import { useApp } from "~/nav"

const STARTS: readonly (readonly [ModStart, string])[] = [
  ["panel", "Panel"],
  ["command", "Command"],
  ["tab", "Tab"],
  ["figure", "Figure"],
]

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/

const kindOf = (name: string): string => {
  const word = name.replace(/[^a-z0-9]/g, "")
  return (/^[a-z]/.test(word) ? word : `m${word}`).slice(0, 32)
}

function startHint(start: ModStart, name: string): string {
  if (start === "panel") return "A panel beside the chat, with a list to start from."
  if (start === "command") return "An action in ⌘K that shows a note."
  if (start === "tab") return "A tab in the channel's header, after Agents."
  return `It draws attachments named like chart.${kindOf(name || "my-mod")}.html in chat.`
}

const failed = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const askText = (words: string): string => `Make me a mod: ${words.trim()}\n\nUse your mods skill, and tell me when it's ready to try.`

function Make({ onClose }: { onClose: () => void }) {
  const { go, toast } = useApp()
  const [name, setName] = useState("")
  const [start, setStart] = useState<ModStart>("panel")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const create = modReads().createMod
  const typed = name.trim()
  const wrong = typed && !NAME.test(typed) ? "Lowercase letters, digits and dashes, like standup-notes." : null

  const make = async (e: FormEvent) => {
    e.preventDefault()
    if (!create || !typed || wrong || busy) return
    setBusy(true)
    setProblem(null)
    try {
      await create(typed, start)
    } catch (err) {
      setBusy(false)
      setProblem(failed(err))
      return
    }
    let where = `It's in ~/.kiwi/mods/${typed}`
    const open = modReads().openModFolder
    if (open)
      try {
        const opened = await open(typed)
        where = opened.editor ? `It's open in ${opened.editor}` : `It's in ${opened.dir}`
      } catch {
        // Not opened: the toast still says where the folder is.
      }
    toast(`${typed} is on. ${where}, and each save reloads it.`)
    onClose()
    go({ to: "settings", section: "mods", mod: typed })
  }

  return (
    <form className="mod-new" onSubmit={(e) => void make(e)}>
      <Field label="Name" hint={wrong ?? "Its folder in ~/.kiwi/mods and its name in ⌘K."}>
        <input
          className="input is-mono"
          ref={autofocus}
          autoComplete="off"
          spellCheck={false}
          maxLength={63}
          placeholder="standup-notes"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          aria-invalid={wrong ? true : undefined}
        />
      </Field>
      <div className="field">
        <span className="field-label">It starts as</span>
        <Track className="seg" role="group" aria-label="It starts as">
          {STARTS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={start === id} onClick={() => setStart(id)}>
              {label}
            </button>
          ))}
        </Track>
        <span className="field-hint">{startHint(start, typed)}</span>
      </div>
      {problem && (
        <p className="mod-new-note is-error" role="alert">
          {problem}
        </p>
      )}
      {!create && <p className="mod-new-note">Update Channels to make a mod here.</p>}
      <div className="modal-foot">
        <button type="button" className="btn is-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn is-primary" disabled={!create || !typed || !!wrong || busy}>
          {busy ? "Making it…" : "Make it"}
        </button>
      </div>
    </form>
  )
}

function Ask({ onClose }: { onClose: () => void }) {
  const { app, go, toast } = useApp()
  const channel = app.channel
  const agents = channel ? channel.people.filter((p) => p.kind === "agent" && !p.left && !p.you) : []
  const lead = channel?.lead && agents.some((a) => a.name === channel.lead) ? channel.lead : null
  const [who, setWho] = useState<string | null>(null)
  const [words, setWords] = useState("")
  const [busy, setBusy] = useState(false)
  const pick = who ?? lead ?? agents[0]?.name ?? null

  const ask = async (e: FormEvent) => {
    e.preventDefault()
    if (!channel || !pick || !words.trim() || busy) return
    setBusy(true)
    const sent = await app.actions.send(channel.code, { kind: "dm", with: pick }, askText(words))
    setBusy(false)
    if (!sent) return
    toast(`Sent to ${nickname(channel, pick)} in ${channel.title}`)
    onClose()
    go({ to: "where", where: { kind: "dm", with: seatRoot(channel, pick) } })
  }

  return (
    <form className="mod-new" onSubmit={(e) => void ask(e)}>
      <Field label="What should it do?" hint="An agent builds it with its mods skill, then tells you it's ready.">
        <textarea className="textarea" rows={4} ref={autofocus} value={words} onChange={(e) => setWords(e.target.value)} placeholder="A panel with my open Linear issues, newest first" />
      </Field>
      {channel && agents.length > 1 && pick && (
        <Field label="Who builds it" hint={`In ${channel.title}.`}>
          <select className="input" value={pick} onChange={(e) => setWho(e.target.value)}>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {nickname(channel, a.name)}
                {a.name === lead ? " (lead)" : ""}
              </option>
            ))}
          </select>
        </Field>
      )}
      {channel && agents.length === 1 && pick && (
        <p className="mod-new-note">
          {nickname(channel, pick)} builds it, in {channel.title}.
        </p>
      )}
      {(!channel || !pick) && <p className="mod-new-note">Open a channel with an agent in it, and that agent builds it.</p>}
      <div className="modal-foot">
        <button type="button" className="btn is-quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn is-primary" disabled={!channel || !pick || !words.trim() || busy}>
          {busy ? "Sending…" : "Ask"}
        </button>
      </div>
    </form>
  )
}

export function NewModDialog() {
  const { go } = useApp()
  const [tab, setTab] = useState<"make" | "ask">("make")
  const close = () => go({ to: "dialog", dialog: null })
  return (
    <Modal
      dismiss="x"
      onClose={close}
      label="New mod"
      title="New mod"
      sub="It runs in its own frame, away from your keys and messages."
      tabs={
        <Track className="seg modal-seg" role="group" aria-label="How">
          <button type="button" aria-pressed={tab === "make"} onClick={() => setTab("make")}>
            Make one
          </button>
          <button type="button" aria-pressed={tab === "ask"} onClick={() => setTab("ask")}>
            Ask an agent
          </button>
        </Track>
      }
    >
      {tab === "make" ? <Make key="make" onClose={close} /> : <Ask key="ask" onClose={close} />}
    </Modal>
  )
}
