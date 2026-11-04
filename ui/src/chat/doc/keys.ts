import { baseKeymap, chainCommands, splitBlock, toggleMark } from "prosemirror-commands"
import { keymap } from "prosemirror-keymap"
import { TextSelection, type Command, type EditorState, type Plugin } from "prosemirror-state"
import { liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list"
import { redo, undo } from "y-prosemirror"

import { blockAfter, blockAt, blocks, endsBlock, isEmpty, joinBack, joinForward, startBlock } from "~/chat/doc/blocks"
import { attrsOf, schema } from "~/chat/doc/schema"

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

function dropOwnEmpty(me: string): Command {
  return (state, dispatch) => {
    const here = blockAt(state)
    if (!here || here.index === 0 || !isEmpty(here.node) || attrsOf(here.node).author !== me) return false
    if (dispatch) {
      const tr = state.tr.setMeta("addToHistory", false).delete(here.pos, here.pos + here.node.nodeSize)
      dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(here.pos - 1), -1)).scrollIntoView())
    }
    return true
  }
}

function join(me: string, how: typeof joinBack): Command {
  return (state, dispatch) => {
    const tr = how(state, me)
    if (tr && dispatch) dispatch(tr)
    return !!tr
  }
}

function toYourLine(me: string): Command {
  return (state, dispatch, view) => {
    const { $from, empty } = state.selection
    const last = blocks(state.doc).at(-1)
    if (!empty || !last || $from.index(0) !== last.index || (view && !view.endOfTextblock("down"))) return false
    if (isEmpty(last.node) && attrsOf(last.node).author === me) return false
    if (dispatch) dispatch(startBlock(state, me, Date.now()).scrollIntoView())
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

function endBlock(me: string, now: () => number): Command {
  return (state, dispatch) => (endsBlock(state) ? nextBlock(me, now)(state, dispatch) : false)
}

const quietEmpty: Command = (state) => {
  const here = blockAt(state)
  return !!here && isEmpty(here.node)
}

export function docKeys(me: string, now: () => number, blur: () => void): Plugin[] {
  const item = schema.nodes.list_item
  return [
    keymap({
      "Mod-z": undo,
      "Mod-y": redo,
      "Mod-Shift-z": redo,
      "Mod-b": toggleMark(schema.marks.strong),
      "Mod-i": toggleMark(schema.marks.em),
      "Mod-e": toggleMark(schema.marks.code),
      "Mod-Shift-x": toggleMark(schema.marks.strike),
      "Mod-Enter": nextBlock(me, now),
      Enter: chainCommands(leaveCode, newline, emptyItem, splitListItem(item), endBlock(me, now), quietEmpty, splitBlock),
      "Shift-Enter": chainCommands(newline, splitListItem(item), splitBlock),
      Tab: (state, dispatch) => inList(state) && (sinkListItem(item)(state, dispatch) || true),
      "Shift-Tab": (state, dispatch) => inList(state) && (liftListItem(item)(state, dispatch) || true),
      Backspace: chainCommands(dropOwnEmpty(me), startOfItem, join(me, joinBack)),
      Delete: join(me, joinForward),
      ArrowDown: toYourLine(me),
      Escape: () => {
        blur()
        return true
      },
    }),
    keymap(baseKeymap),
  ]
}
