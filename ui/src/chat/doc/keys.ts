import { baseKeymap, chainCommands, splitBlock, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import type { Node } from "prosemirror-model"
import { TextSelection, type Command, type EditorState, type Plugin } from "prosemirror-state"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { redo, undo } from "y-prosemirror"

import { blockAfter, blockAt, blocks, isEmpty, joinBack, joinForward, startBlock, unreply, type Made } from "~/chat/doc/blocks"
import { attrsOf, isSent, schema } from "~/chat/doc/schema"
import { noteTyping } from "~/kit/typing-hook"

function inCode(state: EditorState): boolean {
  return !!state.selection.$from.parent.type.spec.code
}

function inList(state: EditorState): boolean {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === schema.nodes.list_item) return true
  return false
}

const newline: Command = (state, dispatch) => {
  if (!inCode(state)) return false
  if (dispatch) dispatch(state.tr.insertText("\n").scrollIntoView())
  return true
}

const leaveCode: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || !inCode(state) || $from.parentOffset !== $from.parent.content.size || !$from.parent.textContent.endsWith("\n")) return false
  if (dispatch) {
    const after = $from.after()
    const tr = state.tr.delete($from.pos - 1, $from.pos)
    const at = tr.mapping.map(after)
    tr.insert(at, schema.nodes.paragraph.create())
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 1)).scrollIntoView())
  }
  return true
}

const emptyItem: Command = (state, dispatch) => {
  const { $from } = state.selection
  if (!inList(state) || $from.parent.content.size !== 0) return false
  return liftListItem(schema.nodes.list_item)(state, dispatch)
}

const startOfItem: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || !inList(state) || $from.parentOffset !== 0) return false
  return liftListItem(schema.nodes.list_item)(state, dispatch)
}

export function dropOwnEmpty(me: string, posted: (block: string) => boolean): Command {
  return (state, dispatch) => {
    const here = blockAt(state)
    if (!here || here.index === 0 || !isEmpty(here.node) || attrsOf(here.node).author !== me) return false
    const prev = state.doc.child(here.index - 1)
    if (isSent(prev) || posted(attrsOf(prev).id)) return true
    if (dispatch) {
      noteTyping(() => ({ what: "Backspace dropped an empty line", block: attrsOf(here.node).id }))
      const tr = state.tr.setMeta("addToHistory", false).delete(here.pos, here.pos + here.node.nodeSize)
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(here.pos - 1), -1)).scrollIntoView())
    }
    return true
  }
}

function join(me: string, how: typeof joinBack, posted: (block: string) => boolean): Command {
  return (state, dispatch) => {
    const tr = how(state, me, posted)
    if (tr && dispatch) dispatch(tr)
    return !!tr
  }
}

function toYourLine(me: string, posted: (block: string) => boolean, made: Made): Command {
  return (state, dispatch, view) => {
    const { $from, empty } = state.selection
    const last = blocks(state.doc).at(-1)
    if (!empty || !last || $from.index(0) !== last.index || (view && !view.endOfTextblock("down"))) return false
    if (isEmpty(last.node) && attrsOf(last.node).author === me) return false
    if (dispatch) dispatch(startBlock(state, me, Date.now(), posted, made).scrollIntoView())
    return true
  }
}

function nextBlock(me: string, now: () => number): Command {
  return (state, dispatch) => {
    const tr = blockAfter(state, me, now())
    if (tr && dispatch) dispatch(tr.scrollIntoView())
    return !!tr
  }
}

const quietEmpty: Command = (state) => {
  const here = blockAt(state)
  return !!here && isEmpty(here.node)
}

function dropReply(me: string): Command {
  return (state, dispatch) => {
    const here = blockAt(state)
    const a = here ? attrsOf(here.node) : null
    const tr = a && a.re !== null && a.author === me ? unreply(state, a.id) : null
    if (!tr) return false
    dispatch?.(tr)
    return true
  }
}

export type CommandFor = (line: string) => (() => void) | null

function runLine(me: string, commandFor: CommandFor): Command {
  return (state, dispatch) => {
    const here = blockAt(state)
    if (!here || here.node.childCount !== 1 || isSent(here.node) || attrsOf(here.node).author !== me) return false
    const go = commandFor(here.node.textContent)
    if (!go) return false
    if (dispatch) {
      const tr = state.tr.replaceWith(here.pos + 1, here.pos + here.node.nodeSize - 1, schema.nodes.paragraph.create())
      dispatch(tr.setSelection(TextSelection.create(tr.doc, here.pos + 2)))
      go()
    }
    return true
  }
}

export interface DocKeyOpts {
  posted?: (block: string) => boolean
  commandFor?: CommandFor
  refuse?: (line: string) => boolean
  editLast?: () => boolean
  made?: Made
}

function mineHere(state: EditorState, me: string): Node | null {
  const here = blockAt(state)
  return here && attrsOf(here.node).author === me && !isSent(here.node) ? here.node : null
}

function unlessRefused(me: string, refuse: (line: string) => boolean, finish: Command): Command {
  return (state, dispatch, view) => {
    if (!finish(state, undefined, view)) return false
    const mine = mineHere(state, me)
    if (mine && refuse(mine.textContent)) return true
    return finish(state, dispatch, view)
  }
}

function editLast(me: string, edit: () => boolean): Command {
  return (state) => {
    const mine = mineHere(state, me)
    return !!mine && state.selection.empty && isEmpty(mine) && edit()
  }
}

export function docKeys(me: string, now: () => number, blur: () => void, opts: DocKeyOpts = {}): Plugin[] {
  const item = schema.nodes.list_item
  const posted = opts.posted ?? (() => false)
  const commandFor = opts.commandFor ?? (() => null)
  const refuse = opts.refuse ?? (() => false)
  return [
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
      "Mod-b": toggleMark(schema.marks.strong),
      "Mod-i": toggleMark(schema.marks.em),
      "Mod-e": toggleMark(schema.marks.code),
      "Mod-Shift-x": toggleMark(schema.marks.strike),
      "Mod-Enter": chainCommands(runLine(me, commandFor), quietEmpty, unlessRefused(me, refuse, nextBlock(me, now))),
      Enter: chainCommands(leaveCode, newline, emptyItem, splitListItem(item), splitBlock),
      "Shift-Enter": chainCommands(newline, splitListItem(item), splitBlock),
      Tab: (state, dispatch) => inList(state) && (sinkListItem(item)(state, dispatch) || true),
      "Shift-Tab": (state, dispatch) => inList(state) && (liftListItem(item)(state, dispatch) || true),
      Backspace: chainCommands(dropOwnEmpty(me, posted), startOfItem, join(me, joinBack, posted)),
      Delete: join(me, joinForward, posted),
      ArrowDown: unlessRefused(me, refuse, toYourLine(me, posted, opts.made ?? (() => true))),
      ArrowUp: editLast(me, opts.editLast ?? (() => false)),
      Escape: chainCommands(dropReply(me), () => {
        blur()
        return true
      }),
    }),
    keymap(baseKeymap),
  ]
}
