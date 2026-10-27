import { inlineText } from "../membership.ts";
import type { ChannelState } from "./types.ts";

const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+/gu;
const CODE = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\S\n]*$|(?![\s\S]))|^(?: {4}|\t).*$|(`+)(?!`)[\s\S]*?(?<!`)\2(?!`)/gm;
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

export const readsAsHandle = (name: string, label: string): boolean => label !== name && /[._-]/.test(name);

export const bareAt = (text: string, start: number, end: number): boolean => !"=?&#:".includes(text[start - 1] || " ") && !"@/".includes(text[end] || " ");

export function memberNamed(raw: string, labelOf: (name: string) => string | undefined): { name: string; label: string } | null {
  for (let name = raw; name; name = name.slice(0, -1)) {
    const label = labelOf(name);
    if (label !== undefined) return { name, label };
    if (!/[._-]$/.test(name)) return null;
  }
  return null;
}

export function bareHandleNote(state: Pick<ChannelState, "members">, body: string): string | null {
  const labelOf = (name: string) => {
    const m = state.members.get(name);
    return m ? m.display || name : undefined;
  };
  const text = body.replace(CODE, " ").replace(URL, " ");
  const named = new Map<string, string>();
  for (const match of text.matchAll(WORD)) {
    const who = memberNamed(match[0], labelOf);
    if (who && readsAsHandle(who.name, who.label) && bareAt(text, match.index, match.index + who.name.length)) named.set(who.name, who.label);
  }
  if (!named.size) return null;
  const list = [...named].map(([name, label]) => `@${name} (${inlineText(label, 40)})`).join(", ");
  return `People see nicknames, not handles: write ${list} and the app shows the name. Inside code, keep the bare handle.`;
}
