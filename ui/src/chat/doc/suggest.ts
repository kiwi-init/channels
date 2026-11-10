import { Plugin, PluginKey, type EditorState } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { refDone } from "~/chat/matches"

export interface Query {
  kind: "@" | "#" | "/"
  text: string
  from: number
  to: number
}

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const TASK_REF = /(^|\s)#([^#\n]{0,40})$/u
const COMMAND = /^\/([^\s/]*)$/
const DISMISS = "suggest-dismiss"

interface Held {
  query: Query | null
  dismissed: number | null
}

const suggestKey = new PluginKey<Held>("doc-suggest")

function queryAt(state: EditorState): Query | null {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.spec.code || !$from.parent.isTextblock) return null
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 60), $from.parentOffset, undefined, "￼")
  const command = $from.depth === 2 && $from.index(1) === 0 && before.length === $from.parentOffset ? COMMAND.exec(before) : null
  if (command) {
    const text = command[1] ?? ""
    return { kind: "/", text, from: $from.pos - text.length - 1, to: $from.pos }
  }
  const mention = MENTION.exec(before)
  if (mention) {
    const text = mention[2] ?? ""
    return { kind: "@", text, from: $from.pos - text.length - 1, to: $from.pos }
  }
  const task = TASK_REF.exec(before)
  if (task && !refDone(task[2] ?? "")) {
    const text = task[2] ?? ""
    return { kind: "#", text, from: $from.pos - text.length - 1, to: $from.pos }
  }
  return null
}

export type MenuKey = "move" | "choose" | "close"

export function menuKey(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">): MenuKey | null {
  if (e.metaKey || e.ctrlKey || (e.shiftKey && e.key === "Enter")) return null
  if (e.key === "ArrowDown" || e.key === "ArrowUp") return "move"
  if (e.key === "Enter" || e.key === "Tab") return "choose"
  if (e.key === "Escape") return "close"
  return null
}

export function dismiss(view: EditorView): void {
  const q = suggestKey.getState(view.state)?.query
  if (q) view.dispatch(view.state.tr.setMeta(DISMISS, q.from))
}

export function suggestPlugin(onChange: (q: Query | null, view: EditorView) => void, onKey: (e: KeyboardEvent) => boolean): Plugin<Held> {
  return new Plugin<Held>({
    key: suggestKey,
    state: {
      init: () => ({ query: null, dismissed: null }),
      apply(tr, held, _old, state) {
        const off: unknown = tr.getMeta(DISMISS)
        const dismissed = typeof off === "number" ? off : held.dismissed === null ? null : tr.mapping.map(held.dismissed)
        const found = queryAt(state)
        if (!found) return { query: null, dismissed: null }
        return { query: found.from === dismissed ? null : found, dismissed }
      },
    },
    props: {
      handleKeyDown: (view, e) => (suggestKey.getState(view.state)?.query ? onKey(e) : false),
    },
    view: () => ({
      update: (view, prev) => {
        const now = suggestKey.getState(view.state)?.query ?? null
        const was = suggestKey.getState(prev)?.query ?? null
        if (now?.from !== was?.from || now?.text !== was?.text || now?.kind !== was?.kind) onChange(now, view)
      },
      destroy: () => {},
    }),
  })
}
