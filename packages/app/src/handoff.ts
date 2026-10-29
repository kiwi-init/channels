import type { Handoff, Message } from "@kiwi/core/protocol.ts";

export const handoffOf = (m: Message): Handoff | null => (m.esc && m.handoff ? m.handoff : null);

export const handoffOpen = (h: Handoff, now: number): boolean => h.expiresAt > now;

export function handoffLeft(h: Handoff, now: number): string {
  const minutes = Math.max(1, Math.ceil((h.expiresAt - now) / 60_000));
  return minutes === 1 ? "expires in 1 min" : `expires in ${minutes} min`;
}

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
