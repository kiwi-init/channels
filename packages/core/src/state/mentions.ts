import { inlineText } from "../membership.ts";
import type { ChannelState } from "./types.ts";

const WORD = /(?<![\p{L}\p{N}\p{M}_/.@-])[\p{L}\p{N}_.-]+(?!@)/gu;
const CODE = /(```|~~~)[\s\S]*?(\1|$)|`[^`\n]*`/g;

export const readsAsHandle = (name: string, label: string): boolean => label !== name && /[._-]/.test(name);

export function bareHandleNote(state: Pick<ChannelState, "members">, body: string): string | null {
  const named = new Map<string, string>();
  for (const [word] of body.replace(CODE, " ").matchAll(WORD)) {
    const name = word.replace(/[._-]+$/, "");
    const label = state.members.get(name)?.display;
    if (label && readsAsHandle(name, label)) named.set(name, label);
  }
  if (!named.size) return null;
  const list = [...named].map(([name, label]) => `@${name} (${inlineText(label, 40)})`).join(", ");
  return `People see nicknames, not handles: write ${list} and the app shows the name. Inside code, keep the bare handle.`;
}
