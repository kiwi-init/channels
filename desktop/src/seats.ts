import { decodeJoinCode, type ChannelAccess } from "../../src/crypto.ts";
import type { ChannelIdentityView, ChannelView, PublicAccess } from "./bridge.ts";

const str = (v: unknown): v is string => typeof v === "string";

export function publicAccess(a: unknown): PublicAccess | undefined {
  if (!a || typeof a !== "object") return undefined;
  const x = a as Partial<ChannelAccess>;
  if (!str(x.roomId) || !str(x.ownerPk) || !str(x.ownerXpk) || typeof x.epoch !== "number") return undefined;
  return { roomId: x.roomId, ownerPk: x.ownerPk, ownerXpk: x.ownerXpk, epoch: x.epoch, ...(x.signedKeys ? { signedKeys: true } : {}), ...(x.signedTitle ? { signedTitle: true } : {}) };
}

export function publicChannel(c: ChannelIdentityView): ChannelView {
  const access = publicAccess(c.access);
  return {
    label: c.label,
    pk: c.pk,
    ...(c.xpk !== undefined ? { xpk: c.xpk } : {}),
    ...(c.roomId !== undefined ? { roomId: c.roomId } : {}),
    ...(c.code !== undefined ? { code: c.code } : {}),
    ...(c.idName !== undefined ? { idName: c.idName } : {}),
    ...(c.name !== undefined ? { name: c.name } : {}),
    ...(access ? { access } : {}),
    ...(c.at !== undefined ? { at: c.at } : {}),
    ...(c.requestId !== undefined ? { requestId: c.requestId } : {}),
  };
}

export function channelAccess(c: ChannelIdentityView): ChannelAccess | null {
  const pub = publicAccess(c.access);
  const keys = c.access && typeof c.access === "object" ? (c.access as { keys?: unknown }).keys : undefined;
  if (!pub || !keys || typeof keys !== "object") return null;
  return { ...pub, keys: Object.fromEntries(Object.entries(keys).filter((e): e is [string, string] => str(e[1]))) };
}

function epochKeys(access: unknown): Map<string, string> {
  const keys = access && typeof access === "object" ? (access as { keys?: unknown }).keys : undefined;
  if (!keys || typeof keys !== "object") return new Map();
  return new Map(Object.entries(keys).filter((e): e is [string, string] => str(e[1])));
}

export const seatOf = (c: { roomId?: string; pk: string }): string => `${c.roomId ?? ""}/${c.pk}`;

export function mergeChannels(stored: ChannelIdentityView[], next: ChannelIdentityView[]): ChannelIdentityView[] {
  const before = new Map(stored.map((c) => [seatOf(c), c]));
  for (const c of next) {
    const old = before.get(seatOf(c));
    if (!old) continue;
    const changed = c.sk !== old.sk || (old.xsk !== undefined && c.xsk !== old.xsk);
    const now = epochKeys(c.access);
    const lost = [...epochKeys(old.access)].some(([e, k]) => now.get(e) !== k);
    if (changed || lost) throw new Error(`the keys of a saved channel can't change (${c.label})`);
  }
  return next;
}

export function mergePublicChannels(stored: ChannelIdentityView[], next: unknown): ChannelIdentityView[] {
  if (!Array.isArray(next)) throw new Error("bad channel list");
  const known = new Set(stored.map(seatOf));
  const names = new Map<string, Partial<Pick<ChannelIdentityView, "label" | "name">>>();
  for (const v of next) {
    if (!v || typeof v !== "object") throw new Error("bad channel list");
    const c = v as Record<string, unknown>;
    const access = c.access;
    if ("sk" in c || "xsk" in c || (access && typeof access === "object" && "keys" in access)) throw new Error("the window can't save channel keys");
    if (!str(c.pk)) throw new Error("bad channel list");
    const seat = `${str(c.roomId) ? c.roomId : ""}/${c.pk}`;
    if (names.has(seat)) throw new Error("bad channel list");
    if (!known.has(seat)) continue;
    names.set(seat, { ...(str(c.label) ? { label: c.label.slice(0, 200) } : {}), ...(str(c.name) ? { name: c.name.slice(0, 200) } : {}) });
  }
  return stored.map((c) => {
    const n = names.get(seatOf(c));
    return n ? { ...c, ...n } : c;
  });
}

function keepChannel(old: ChannelIdentityView, next: ChannelIdentityView): void {
  const a = publicAccess(old.access);
  if (!a) return;
  const b = publicAccess(next.access);
  if (!b || b.roomId !== a.roomId || b.ownerPk !== a.ownerPk || b.ownerXpk !== a.ownerXpk || b.epoch < a.epoch || (old.roomId !== undefined && next.roomId !== old.roomId)) throw new Error(`a saved channel can't change its room, owner or epoch (${old.label})`);
}

export function acceptSeat(stored: ChannelIdentityView[], entry: ChannelIdentityView): ChannelIdentityView[] {
  const code = entry.code;
  const other = code ? stored.find((c) => c.code === code && c.access && c.pk !== entry.pk) : undefined;
  if (other) throw new Error(`this app is already in this channel as ${other.idName ?? other.label}`);
  const same = stored.find((c) => c.pk === entry.pk && c.code === code);
  if (same) {
    if (same.sk !== entry.sk || (same.xsk !== undefined && same.xsk !== entry.xsk)) throw new Error(`the keys of a saved channel can't change (${entry.label})`);
    const now = epochKeys(entry.access);
    if ([...epochKeys(same.access)].some(([e, k]) => now.get(e) !== k)) throw new Error(`the keys of a saved channel can't change (${entry.label})`);
    keepChannel(same, entry);
  }
  return [...stored.filter((c) => c !== same && !(code && c.code === code)), entry];
}

export function withAccess(stored: ChannelIdentityView[], code: string, pk: string, access: ChannelAccess): ChannelIdentityView[] {
  const seat = stored.find((c) => c.code === code && c.pk === pk && c.access);
  if (!seat) return stored;
  const next = { ...seat, access: { ...access, keys: { ...access.keys } } };
  mergeChannels([seat], [next]);
  keepChannel(seat, next);
  return stored.map((c) => (c === seat ? next : c));
}

export function wellFormedEntry(v: unknown): v is ChannelIdentityView {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  if (!str(c.label) || !str(c.pk) || !str(c.sk) || !str(c.code)) return false;
  for (const k of ["xpk", "xsk", "roomId", "idName", "name", "requestId"]) if (c[k] !== undefined && !str(c[k])) return false;
  if (c.at !== undefined && typeof c.at !== "number") return false;
  if (c.access !== undefined) {
    if (!publicAccess(c.access)) return false;
    const keys = (c.access as { keys?: unknown }).keys;
    if (!keys || typeof keys !== "object" || Object.values(keys).some((k) => !str(k))) return false;
  } else if (!str(c.requestId)) return false;
  return true;
}

function cleanEntry(e: ChannelIdentityView): ChannelIdentityView | null {
  let room: string;
  try {
    room = decodeJoinCode(e.code ?? "").roomId;
  } catch {
    return null;
  }
  const pub = publicAccess(e.access);
  if (pub && (pub.roomId !== room || (e.roomId !== undefined && e.roomId !== room))) return null;
  const keys = e.access ? epochKeys(e.access) : null;
  return {
    label: e.label.slice(0, 200),
    pk: e.pk,
    sk: e.sk,
    ...(e.xpk !== undefined ? { xpk: e.xpk } : {}),
    ...(e.xsk !== undefined ? { xsk: e.xsk } : {}),
    ...(pub ? { roomId: room } : {}),
    code: e.code,
    ...(e.idName !== undefined ? { idName: e.idName.slice(0, 200) } : {}),
    ...(e.name !== undefined ? { name: e.name.slice(0, 200) } : {}),
    ...(pub && keys ? { access: { ...pub, keys: Object.fromEntries(keys) } } : {}),
    ...(e.at !== undefined ? { at: e.at } : {}),
    ...(!pub && e.requestId !== undefined ? { requestId: e.requestId } : {}),
    imported: true,
  };
}

export function migrateEntries(stored: ChannelIdentityView[], entries: unknown): { channels: ChannelIdentityView[]; added: number } {
  if (!Array.isArray(entries)) return { channels: stored, added: 0 };
  const channels = [...stored];
  let added = 0;
  for (const raw of entries) {
    if (!wellFormedEntry(raw)) continue;
    const e = cleanEntry(raw);
    if (!e || channels.some((c) => c.code === e.code || c.pk === e.pk)) continue;
    channels.push(e);
    added++;
  }
  return { channels, added };
}
