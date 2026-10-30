import type { ChannelIdentityView } from "../../../desktop/src/bridge.ts";
import { CHANNELS_KEY, MEMBER_PREFIX, PENDING_PREFIX } from "@kiwi/secrets/local-store.ts";

export interface KeyValues {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  removeItem(k: string): void;
}

interface Legacy {
  code?: unknown;
  identity?: { name?: unknown; pk?: unknown; sk?: unknown; xpk?: unknown; xsk?: unknown };
  access?: { roomId?: unknown };
  at?: unknown;
  name?: unknown;
  requestId?: unknown;
}

function legacyEntry(v: Legacy | null): ChannelIdentityView | null {
  const id = v?.identity;
  if (!v || typeof v.code !== "string" || !id || typeof id.name !== "string" || typeof id.pk !== "string" || typeof id.sk !== "string") return null;
  const keys = { pk: id.pk, sk: id.sk, ...(typeof id.xpk === "string" ? { xpk: id.xpk } : {}), ...(typeof id.xsk === "string" ? { xsk: id.xsk } : {}) };
  const name = typeof v.name === "string" ? v.name : undefined;
  if (v.access && typeof v.access.roomId === "string") {
    return { label: name ?? id.name, idName: id.name, ...keys, roomId: v.access.roomId, code: v.code, access: v.access, at: typeof v.at === "number" ? v.at : 0, ...(name ? { name } : {}) };
  }
  return typeof v.requestId === "string" ? { label: id.name, idName: id.name, ...keys, code: v.code, requestId: v.requestId } : null;
}

function parsed(raw: string | null): Legacy | null {
  try {
    return JSON.parse(raw ?? "null") as Legacy | null;
  } catch {
    return null;
  }
}

export async function migrateLegacy(storage: KeyValues, migrate: (entries: ChannelIdentityView[]) => Promise<number>): Promise<number> {
  const found: { key: string; entry: ChannelIdentityView }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k?.startsWith(MEMBER_PREFIX) && !k?.startsWith(PENDING_PREFIX)) continue;
    const entry = legacyEntry(parsed(storage.getItem(k)));
    if (entry) found.push({ key: k, entry });
  }
  const added = await migrate(found.map((f) => f.entry));
  for (const { key } of found) storage.removeItem(key);
  if (found.length) storage.removeItem(CHANNELS_KEY);
  return added;
}
