import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { inlineText } from "@kiwi/core/membership.ts";
import { bareAt, memberNamed, readsAsHandle, type ChannelState } from "@kiwi/core/state.ts";

const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu;
const NOT_PROSE = new Set(["link", "linkReference", "definition", "code", "inlineCode", "html"]);

type MdNode = { type: string; value?: string; children?: MdNode[] };

function prose(node: MdNode): string[] {
  if (NOT_PROSE.has(node.type)) return [];
  if (node.type === "text") return [node.value ?? ""];
  return (node.children ?? []).flatMap(prose);
}

export function bareHandleNote(state: Pick<ChannelState, "members">, body: string): string | null {
  const labelOf = (name: string) => {
    const m = state.members.get(name);
    return m ? m.display || name : undefined;
  };
  const named = new Map<string, string>();
  for (const text of prose(fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })))
    for (const match of text.matchAll(WORD)) {
      const who = memberNamed(match[0], labelOf);
      if (who && readsAsHandle(who.name, who.label) && bareAt(text, match.index, match.index + who.name.length)) named.set(who.name, who.label);
    }
  if (!named.size) return null;
  const list = [...named].map(([name, label]) => `@${name} (${inlineText(label, 40)})`).join(", ");
  return `People see nicknames, not handles: write ${list} and the app shows the name. Inside code, keep the bare handle.`;
}
