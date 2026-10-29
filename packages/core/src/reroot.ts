import { canonical, sign, signText, verifyText, type Identity } from "./identity.ts";
import { wasRoot, type DeviceLink, type DeviceList, type LinkHead, type RerootFields } from "./devices.ts";
import { readRecovery, type RecoveryLink } from "./recovery.ts";

type RerootBody = LinkHead & Omit<RerootFields, "rsig">;

const rerootStatement = (body: RerootBody): string => `kiwi-reroot\n${canonical(body)}`;

export async function rerootLink(list: DeviceList, recovery: Identity, chain: RecoveryLink[], root: Identity, keep: readonly string[], at = Date.now()): Promise<DeviceLink> {
  const body: RerootBody = {
    kind: "kiwi-device-link",
    v: 1,
    person: list.person,
    seq: list.version + 1,
    prev: list.head,
    at,
    op: "reroot",
    root: root.pk,
    keep: [...new Set(keep)].sort(),
    recovery: chain,
  };
  return sign(root, { ...body, rsig: await signText(recovery, rerootStatement(body)) });
}

export async function rerooted(link: LinkHead & RerootFields & { pk: string; sig: string }, so: DeviceList): Promise<{ n: number; head: string } | string> {
  if (wasRoot(so.person, so.reroots, link.root) || so.devices.some((d) => d.device === link.root) || so.revoked.includes(link.root)) return "a re-root to a key this person already used";
  if (link.keep.some((k) => !so.devices.some((d) => d.device === k))) return "a re-root keeping a device that isn't listed";
  const read = await readRecovery(link.recovery, so, link.at);
  if (!read.ok) return `a re-root whose recovery chain doesn't hold up: ${read.why}`;
  if (read.recovery.n < (so.reroots.at(-1)?.n ?? 0)) return "a re-root signed against an older recovery chain than the last one";
  const body: RerootBody = { kind: link.kind, v: link.v, person: link.person, seq: link.seq, prev: link.prev, at: link.at, op: link.op, root: link.root, keep: link.keep, recovery: link.recovery };
  if (!(await verifyText(read.recovery.rpk, link.rsig, rerootStatement(body)))) return "a re-root not signed by the recovery key";
  return { n: read.recovery.n, head: read.recovery.head };
}
