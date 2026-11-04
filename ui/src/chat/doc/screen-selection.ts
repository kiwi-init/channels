import { EditorState, TextSelection, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { getRelativeSelection, ySyncPluginKey } from "y-prosemirror"

import { bindingOf } from "~/chat/doc/own-writes"

const remote = (tr: Transaction): boolean => {
  const meta: unknown = tr.getMeta(ySyncPluginKey)
  return !!meta && typeof meta === "object" && "isChangeOrigin" in meta && !!meta.isChangeOrigin
}

function onScreen(view: EditorView): TextSelection | null {
  if (view.isDestroyed || view.composing || !view.hasFocus()) return null
  const now = view.state.selection
  if (!(now instanceof TextSelection)) return null
  const dom = view.dom.ownerDocument.getSelection()
  if (!dom?.anchorNode || !dom.focusNode || !view.dom.contains(dom.anchorNode) || !view.dom.contains(dom.focusNode)) return null
  let anchor: number
  let head: number
  try {
    anchor = view.posAtDOM(dom.anchorNode, dom.anchorOffset, 1)
    head = view.posAtDOM(dom.focusNode, dom.focusOffset, 1)
  } catch {
    // A spot ProseMirror can't place (a widget, a node view's own frame): its selection stays as it is.
    return null
  }
  if (anchor < 0 || head < 0 || (anchor === now.anchor && head === now.head)) return null
  const { doc } = view.state
  if (!doc.resolve(anchor).parent.inlineContent || !doc.resolve(head).parent.inlineContent) return null
  return TextSelection.create(doc, anchor, head)
}

export function withScreenSelection(view: EditorView, tr: Transaction): Transaction {
  if (tr.selectionSet || remote(tr)) return tr
  const shown = onScreen(view)
  return shown ? tr.setSelection(shown.map(tr.doc, tr.mapping)) : tr
}

export function keepScreenSelection(view: EditorView): () => void {
  const binding = bindingOf(view.state)
  if (!binding) return () => {}
  const take = (): void => {
    const shown = onScreen(view)
    if (shown) binding.beforeTransactionSelection = getRelativeSelection(binding, EditorState.create({ doc: view.state.doc, selection: shown }))
  }
  binding.doc.on("beforeAllTransactions", take)
  return () => binding.doc.off("beforeAllTransactions", take)
}
