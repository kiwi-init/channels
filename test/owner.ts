// Test helper: set channels up the way the app does, through src/client.ts.
//
// The app holds a person key (which certifies computers) plus one channel identity per channel.
// Owners approve through the client library; agents join with computer claims, people with person
// claims. Tests that set channels up with raw create/approve calls should use this instead.

import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import type { JoinRequest } from "@kiwi/core/membership.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Member, MemberInfo } from "@kiwi/core/membership.ts";
import { certifyMachine, claimComputer, provePerson, type MachineCert } from "@kiwi/core/person.ts";
import { checked, memoryBudget } from "./check.ts";

/** A channel made the way the app makes one: the owner's record carries their person key. */
export interface OwnerSetup {
  relay: string;
  code: string;
  roomId: string;
  access: ChannelAccess;
  /** The channel's owner identity (signs approvals). */
  owner: Identity;
  /** The owner's person key (certifies computers, marks own requests). */
  person: Identity;
  ownerCh: Channel;
}

/** A channel owned by `ownerName`'s person key, with that person admitted as the owner. */
export async function setupChannel(relay: string, opts: { ownerName?: string; personName?: string; human?: string | null } = {}): Promise<OwnerSetup> {
  const owner = await generateIdentity(opts.ownerName ?? "owner");
  const person = await generateIdentity(opts.personName ?? "person");
  const { code, access } = await Channel.create(relay, owner, { name: owner.name, kind: "human", person: person.pk }, [], undefined, opts.human ?? null);
  return { relay, code, roomId: access.roomId, access, owner, person, ownerCh: new Channel(access, relay, owner) };
}

/** A computer the person's app certified (what `kiwi pair` stores as machine.json's cert). */
export interface PairedComputer {
  machine: Identity;
  cert: MachineCert;
}

export async function pairComputer(person: Identity, label = "test-computer"): Promise<PairedComputer> {
  const machine = await generateIdentity("machine");
  if (!machine.xpk) throw new Error("machine identity has no exchange key");
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk, label });
  return { machine, cert };
}

/** Run the join-check handshake the way the two clients do: the owner signs halves, joiners reveal. */
export async function handshake(s: Pick<OwnerSetup, "relay" | "code"> & { ownerCh: Channel }, joiners: { id: Identity; requestId: string }[]): Promise<JoinRequest[]> {
  return checked(s.ownerCh, s.relay, s.code, joiners, memoryBudget());
}

/** An agent on a paired computer asks to join, and the owner lets it in. */
export async function joinAgent(
  s: OwnerSetup,
  name: string,
  computer: PairedComputer,
  opts: { auto?: boolean; role?: string } = {},
): Promise<{ id: Identity; ch: Channel; member: Member; req: JoinRequest }> {
  const id = await generateIdentity(name);
  const claim = await claimComputer(computer.machine, computer.cert, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name, ...(opts.role ? { role: opts.role } : {}) }, { computer: claim });
  let req: JoinRequest;
  if (opts.auto) {
    // The app's background loop: sign own halves without the budget, let the joiner reveal, approve.
    await s.ownerCh.autoApprove(s.person.pk);
    await Channel.joinStatus(s.relay, s.code, id, requestId);
    const first = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === requestId);
    const approved = await s.ownerCh.autoApprove(s.person.pk);
    if (!approved.length) throw new Error("auto-approval let nobody in");
    req = first!;
  } else {
    await handshake(s, [{ id, requestId }]);
    req = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === requestId)!;
    await s.ownerCh.approve(req, undefined, { person: s.person.pk });
  }
  const st = await Channel.joinStatus(s.relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
  const member = (await s.ownerCh.members()).find((m) => m.pk === id.pk)!;
  return { id, ch: new Channel(st.access, s.relay, id), member, req };
}

/** A person asks to join themself, and the owner lets them in. */
export async function joinPerson(s: OwnerSetup, name: string, person: Identity, as?: Partial<MemberInfo>): Promise<{ id: Identity; ch: Channel; member: Member }> {
  const id = await generateIdentity(name);
  const claim = await provePerson(person, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { person: claim });
  const req = (await handshake(s, [{ id, requestId }])).find((r) => r.id === requestId)!;
  await s.ownerCh.approve(req, as, { person: s.person.pk });
  const st = await Channel.joinStatus(s.relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
  const member = (await s.ownerCh.members()).find((m) => m.pk === id.pk)!;
  return { id, ch: new Channel(st.access, s.relay, id), member };
}

const ADMIN = new Set(["create", "quick", "requests", "approve", "deny", "kick", "close", "role", "room", "images"]);

/** The command line for `kiwi ARGS` in a CLI test: the owner's verbs (gone from kiwi, the app's now) go to test/owner-cli.ts. */
export function kiwiCmd(args: string[]): string[] {
  let i = 0;
  while (i < args.length && /^-/.test(args[i]!)) i += /^--(yes|open|json)$/.test(args[i]!) ? 1 : 2;
  const script = ADMIN.has(args[i] ?? "") ? "owner-cli.ts" : "../src/cli/main.ts";
  return [process.execPath, join(import.meta.dir, script), ...args];
}
