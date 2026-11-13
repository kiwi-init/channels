// Cached channel icons. Members read them through the sealed API; everyone else sees a letter.

import { useEffect, useState } from "react";

import type { ChannelIcon } from "@kiwi/core/protocol.ts";

import { loadMember, type StoredMember } from "@kiwi/channel/store.ts";
import { linkOf } from "@kiwi/channel/channel-ops.ts";
import { ICON_LIVE } from "@kiwi/channel/icon-event.ts";

const CHANGED = "mc-icons";
const keyOf = (room: string) => `mc.icon.${room}`;

interface Stored {
  at: number | null;
  icon: ChannelIcon | null;
}

function read(room: string): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(keyOf(room)) ?? "null") as Stored | null;
  } catch {
    return null;
  }
}

function write(room: string, stored: Stored): void {
  localStorage.setItem(keyOf(room), JSON.stringify(stored));
  window.dispatchEvent(new Event(CHANGED));
}

/** Refetch when iconAt moved. A channel that never had an icon stays a letter. */
async function refreshIcon(member: StoredMember): Promise<void> {
  const room = member.access.roomId;
  const ch = linkOf(member);
  const at = (await ch.info()).iconAt ?? null;
  const prev = read(room);
  if (prev && prev.at === at) return;
  write(room, { at, icon: at === null ? null : await ch.icon() });
}

function allIcons(): Map<string, ChannelIcon | null> {
  const icons = new Map<string, ChannelIcon | null>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith("mc.icon.")) continue;
    const room = key.slice("mc.icon.".length);
    icons.set(room, read(room)?.icon ?? null);
  }
  return icons;
}

/** Icons for the rooms this browser has cached, updating when one is refetched. */
export function useIcons(): Map<string, ChannelIcon | null> {
  const [icons, setIcons] = useState(allIcons);
  useEffect(() => {
    const bump = () => setIcons(allIcons());
    window.addEventListener(CHANGED, bump);
    return () => window.removeEventListener(CHANGED, bump);
  }, []);
  return icons;
}

export function followIcons(codes: readonly string[], refresh: (code: string) => void): () => void {
  const listed = new Set(codes);
  for (const code of listed) refresh(code);
  const on = (e: Event) => {
    const code = (e as CustomEvent<string>).detail;
    if (listed.has(code)) refresh(code);
  };
  window.addEventListener(ICON_LIVE, on);
  return () => window.removeEventListener(ICON_LIVE, on);
}

const refreshCode = (code: string): void => {
  const member = loadMember(code);
  if (member) void refreshIcon(member).catch(() => {});
};

export function useMemberIcons(codes: string[]): void {
  const list = codes.join("\n");
  useEffect(() => followIcons(list.split("\n").filter(Boolean), refreshCode), [list]);
}
