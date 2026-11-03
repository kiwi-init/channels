import type { Keeps } from "@kiwi/core/client/members.ts";
import { newestLists, readDeviceList, type DeviceClaim, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { Member } from "@kiwi/core/membership.ts";
import { keepLists } from "./forgotten-computers";
import { KEEP_MAX, type DeviceKeep, type Message } from "@kiwi/core/protocol.ts";

type Cut = Member & { why?: string };

const SEEN_KEY = "mc.devices.seen";
const POSTED_KEY = "mc.devices.posted";
const GONE_KEY = "mc.devices.gone";
const KEEP_KEY = "mc.devices.keep";

type Seen = Record<string, { through: number; links: Record<string, DeviceLink[]>; keeps?: Record<string, DeviceClaim> }>;

type Kept = Record<string, { links: DeviceLink[]; keep: DeviceKeep }>;

export interface ListsApi {
  history: (since: number) => Promise<{ messages: Message[] }>;
  cutDevices: (list: DeviceList, keeps: Keeps) => Promise<Cut[]>;
}

export interface GoneApi {
  goneDevices: (list: DeviceList, keeps: Keeps) => Promise<Member[]>;
}

export interface PostApi {
  send: (body: string, opts: { kind: "event"; ev: { op: "devices"; links: DeviceLink[]; keep?: DeviceKeep } }) => Promise<number>;
}

function read<T>(key: string): Partial<T> {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return got && typeof got === "object" && !Array.isArray(got) ? (got as Partial<T>) : {};
  } catch {
    // Storage is off or the value is damaged: start over, the channel logs still hold every list.
    return {};
  }
}

function write(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is off or full: the next pass reads the logs again from where it last saved.
  }
}

export function postedLists(messages: readonly Message[], into: Record<string, DeviceLink[]> = {}): Record<string, DeviceLink[]> {
  const out = { ...into };
  for (const m of messages) {
    if (m.kind !== "event" || m.ev?.op !== "devices") continue;
    const was = out[m.from];
    if (!was || m.ev.links.length >= was.length) out[m.from] = m.ev.links;
  }
  return out;
}

export function postedKeeps(messages: readonly Message[], into: Record<string, DeviceClaim> = {}): Record<string, DeviceClaim> {
  const out = { ...into };
  for (const m of messages) {
    if (!m.sigOk || m.kind !== "event" || m.ev?.op !== "devices" || !m.ev.keep) continue;
    for (const a of m.ev.keep.agents) out[a.pk] = { links: m.ev.links, device: m.ev.keep.device, vouch: a.vouch };
  }
  return out;
}

function keptHere(code: string): Record<string, DeviceClaim> {
  const k = read<Kept>(KEEP_KEY)[code];
  return k ? Object.fromEntries(k.keep.agents.map((a) => [a.pk, { links: k.links, device: k.keep.device, vouch: a.vouch }])) : {};
}

export function keepAgents(code: string, links: DeviceLink[], keep: DeviceKeep): void {
  const all = read<Kept>(KEEP_KEY);
  const was = all[code];
  const agents = new Map((was?.keep.device === keep.device ? was.keep.agents : []).map((a) => [a.pk, a]));
  for (const a of keep.agents) agents.set(a.pk, a);
  write(KEEP_KEY, { ...all, [code]: { links, keep: { device: keep.device, agents: [...agents.values()].slice(-KEEP_MAX) } } });
}

async function scan(code: string, api: Pick<ListsApi, "history">): Promise<void> {
  const seen = read<Seen>(SEEN_KEY);
  const was = seen[code] ?? { through: 0, links: {} };
  const { messages } = await api.history(was.through);
  const through = messages.reduce((n, m) => Math.max(n, m.seq), was.through);
  if (through === was.through) return;
  write(SEEN_KEY, { ...read<Seen>(SEEN_KEY), [code]: { through, links: postedLists(messages, was.links), keeps: postedKeeps(messages, was.keeps) } });
}

const cutFor = new Map<string, Map<string, number>>();

export async function tendLists(code: string, own: readonly DeviceLink[], api: ListsApi): Promise<{ lists: Map<string, DeviceList>; cut: Cut[] }> {
  await scan(code, api);
  const seen = read<Seen>(SEEN_KEY);
  const posted = Object.values(seen).flatMap((c) => (c ? Object.values(c.links) : []));
  const lists = await newestLists(own.length ? [own, ...posted] : posted);
  keepLists(lists);
  const done = cutFor.get(code) ?? new Map<string, number>();
  cutFor.set(code, done);
  const cut: Cut[] = [];
  const keeps = { ...seen[code]?.keeps, ...keptHere(code) };
  for (const list of lists.values()) {
    if (!list.revoked.length || done.get(list.person) === list.version) continue;
    try {
      cut.push(...(await api.cutDevices(list, keeps)));
      done.set(list.person, list.version);
    } catch {
      // The relay or an older app refused: the lists still decide this pass's joins, and the next pass cuts again.
    }
  }
  return { lists, cut };
}

export async function postList(code: string, links: readonly DeviceLink[], api: PostApi): Promise<boolean> {
  const posted = read<Record<string, number>>(POSTED_KEY);
  if (!links.length || (posted[code] ?? 0) >= links.length) return false;
  const kept = read<Kept>(KEEP_KEY)[code];
  await api.send("updated their list of devices", {
    kind: "event",
    ev: { op: "devices", links: [...links], ...(kept ? { keep: kept.keep } : {}) },
  });
  write(POSTED_KEY, { ...read<Record<string, number>>(POSTED_KEY), [code]: links.length });
  return true;
}

export async function goneOwn(code: string, links: readonly DeviceLink[], api: GoneApi): Promise<Member[]> {
  if (!links.length) return [];
  const got = await readDeviceList(links);
  if (!got.ok || !got.list.revoked.length || (read<Record<string, number>>(GONE_KEY)[code] ?? -1) >= got.list.version) return [];
  const gone = await api.goneDevices(got.list, keptHere(code));
  write(GONE_KEY, { ...read<Record<string, number>>(GONE_KEY), [code]: got.list.version });
  return gone;
}
