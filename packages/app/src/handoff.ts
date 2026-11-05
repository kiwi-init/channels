import type { Handoff, Message } from "@kiwi/core/protocol.ts";

export const handoffOf = (m: Message): Handoff | null => (m.esc && m.handoff ? m.handoff : null);

function handoffHost(h: Handoff): string {
  try {
    return new URL(h.url).hostname;
  } catch {
    return "";
  }
}

export function handoffLabel(h: Handoff): string {
  const host = handoffHost(h);
  return host && host !== h.vendor ? `${h.vendor} (${host})` : h.vendor;
}
