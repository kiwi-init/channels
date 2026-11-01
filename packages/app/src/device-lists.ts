import { newestLists, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import type { Member } from "@kiwi/core/membership.ts";
import type { Message } from "@kiwi/core/protocol.ts";

const SEEN_KEY = "mc.devices.seen";
const POSTED_KEY = "mc.devices.posted";

type Seen = Record<string, { through: number; links: Record<string, DeviceLink[]> }>;

export interface ListsApi {
  history: (since: number) => Promise<{ messages: Message[] }>;
  cutDevices: (list: DeviceList) => Promise<Member[]>;
}

export interface PostApi {
  send: (body: string, opts: { kind: "event"; ev: { op: "devices"; links: DeviceLink[] } }) => Promise<number>;
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

async function scan(code: string, api: Pick<ListsApi, "history">): Promise<void> {
  const seen = read<Seen>(SEEN_KEY);
  const was = seen[code] ?? { through: 0, links: {} };
  const { messages } = await api.history(was.through);
  const through = messages.reduce((n, m) => Math.max(n, m.seq), was.through);
  if (through === was.through) return;
  write(SEEN_KEY, { ...read<Seen>(SEEN_KEY), [code]: { through, links: postedLists(messages, was.links) } });
}

const cutFor = new Map<string, Map<string, number>>();

export async function tendLists(code: string, own: readonly DeviceLink[], api: ListsApi): Promise<{ lists: Map<string, DeviceList>; cut: Member[] }> {
  await scan(code, api);
  const posted = Object.values(read<Seen>(SEEN_KEY)).flatMap((c) => (c ? Object.values(c.links) : []));
  const lists = await newestLists(own.length ? [own, ...posted] : posted);
  const done = cutFor.get(code) ?? new Map<string, number>();
  cutFor.set(code, done);
  const cut: Member[] = [];
  for (const list of lists.values()) {
    if ((!list.revoked.length && !list.reroots.length) || done.get(list.person) === list.version) continue;
    try {
      cut.push(...(await api.cutDevices(list)));
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
  await api.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: [...links] } });
  write(POSTED_KEY, { ...read<Record<string, number>>(POSTED_KEY), [code]: links.length });
  return true;
}
