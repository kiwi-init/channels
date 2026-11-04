import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from "prosemirror-inputrules"
import type { MarkType } from "prosemirror-model"
import type { Plugin } from "prosemirror-state"

import { schema } from "~/chat/doc/schema"

function markRule(pattern: RegExp, type: MarkType): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    const inner = match[2]
    const lead = match[1] ?? ""
    if (!inner) return null
    const from = start + lead.length
    const tr = state.tr.delete(from, end).insertText(inner, from)
    tr.addMark(from, from + inner.length, type.create())
    tr.removeStoredMark(type)
    return tr
  })
}

export function markdownRules(): Plugin {
  const { strong, em, code, strike } = schema.marks
  return inputRules({
    rules: [
      markRule(/(^|[^`])`([^`]+)`$/, code),
      markRule(/(^|[^*])\*\*([^*]+)\*\*$/, strong),
      markRule(/(^|[^_\w])__([^_]+)__$/, strong),
      markRule(/(^|[^*])\*([^*\s][^*]*)\*$/, em),
      markRule(/(^|[^_\w])_([^_\s][^_]*)_$/, em),
      markRule(/(^|[^~])~~([^~]+)~~$/, strike),
      wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        schema.nodes.ordered_list,
        (match) => ({ order: Number(match[1]) }),
        (match, node) => node.childCount + Number(node.attrs.order) === Number(match[1])
      ),
      textblockTypeInputRule(/^```$/, schema.nodes.code_block),
    ],
  })
}
