// A person's own key, and what it signs. The desktop app makes it on first run and keeps it; it is
// the person's identity across channels, the way a channel member key is their identity in one.
// It signs two things:
//
//   MachineCert   "this computer is mine": issued when a computer pairs with the app (kiwi pair).
//                 The computer shows it in its agents' join requests (a ComputerClaim), so an owner
//                 knows whose agent is asking without any account at the relay.
//   PersonClaim   "this member key is mine": sent when the person asks to join a channel themselves,
//                 so the owner can sign the person key into their member record and later recognise
//                 that person's computers.
//
// Nothing here touches the file system or the network: the CLI, the daemon, the desktop app and the
// tests share it. Statements name what they are for, so a signature over one can't pass as another.

import { sign, signText, verify, verifyText, type Identity } from "./identity.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const LABEL_MAX = 64;
const NAME_MAX = 80;

/** A person's signature saying a computer's key is theirs. `pk` is the person's key. */
export interface MachineCert {
  kind: "kiwi-machine-cert";
  v: 1;
  /** The person's name, as they gave it to their app ("Jonatas Walker"). */
  name: string;
  /** The computer's Ed25519 key. */
  machine: string;
  /** The computer's X25519 key. */
  mxpk: string;
  /** What the person calls it ("mac-mini", "vps-1"). */
  label: string;
  at: number;
  pk: string;
  sig: string;
}

/** An agent's join request saying which computer it runs on: that computer's cert, and its signature over this agent in this channel. */
export interface ComputerClaim {
  cert: MachineCert;
  /** The computer's signature over vouchStatement(room, agent key). */
  vouch: string;
}

/** A person's join request saying which person key is theirs: the key, and its signature over this member key in this channel. */
export interface PersonClaim {
  person: string;
  proof: string;
}

/** What a computer signs for each of its agents: this agent key, in this channel, is one of mine. */
export const vouchStatement = (roomId: string, agentPk: string) => `kiwi-vouch\n${roomId}\n${agentPk}`;

/** What a person signs when they join: this member key, in this channel, is me. */
export const personStatement = (roomId: string, memberPk: string) => `kiwi-person\n${roomId}\n${memberPk}`;

/** Text a person or a computer chose, bounded and on one line, for a cert. */
function clean(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2060-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** The person's cert for one computer. */
export function certifyMachine(person: Identity, m: { pk: string; xpk: string; label: string }, at = Date.now()): Promise<MachineCert> {
  return sign(person, {
    kind: "kiwi-machine-cert" as const,
    v: 1 as const,
    name: clean(person.name, NAME_MAX) || "someone",
    machine: m.pk,
    mxpk: m.xpk,
    label: clean(m.label, LABEL_MAX) || "a computer",
    at,
  });
}

/** `c` as a cert whose signature checks out, or null. */
export async function readMachineCert(c: unknown): Promise<MachineCert | null> {
  if (!c || typeof c !== "object") return null;
  const x = c as Partial<MachineCert>;
  if (x.kind !== "kiwi-machine-cert" || x.v !== 1) return null;
  if (typeof x.pk !== "string" || !KEY_RE.test(x.pk) || typeof x.machine !== "string" || !KEY_RE.test(x.machine)) return null;
  if (typeof x.mxpk !== "string" || !KEY_RE.test(x.mxpk) || x.machine === x.pk) return null;
  if (typeof x.name !== "string" || x.name.length > NAME_MAX || typeof x.label !== "string" || x.label.length > LABEL_MAX) return null;
  if (!Number.isInteger(x.at)) return null;
  // Only the fields a cert has: anything else would be signed but never shown, so it isn't one.
  const keys = Object.keys(x).sort().join(",");
  if (keys !== "at,kind,label,machine,mxpk,name,pk,sig,v") return null;
  return (await verify(x)) ? (x as MachineCert) : null;
}

/** A computer's claim for one of its agents' join requests. */
export async function claimComputer(machine: Identity, cert: MachineCert, roomId: string, agentPk: string): Promise<ComputerClaim> {
  if (cert.machine !== machine.pk) throw new Error("this cert is for another computer");
  return { cert, vouch: await signText(machine, vouchStatement(roomId, agentPk)) };
}

/**
 * The cert in a join request's computer claim, when the claim holds: a cert some person signed, for the
 * computer that signed this very agent key in this very channel. Null otherwise. Neither the relay nor
 * another agent can produce one: it takes both the person's and the computer's private keys.
 */
export async function checkComputer(c: unknown, roomId: string, agentPk: string): Promise<MachineCert | null> {
  if (!c || typeof c !== "object") return null;
  const claim = c as Partial<ComputerClaim>;
  if (typeof claim.vouch !== "string") return null;
  const cert = await readMachineCert(claim.cert);
  if (!cert) return null;
  return (await verifyText(cert.machine, claim.vouch, vouchStatement(roomId, agentPk))) ? cert : null;
}

/** A person's claim for their own join request. */
export async function provePerson(person: Identity, roomId: string, memberPk: string): Promise<PersonClaim> {
  return { person: person.pk, proof: await signText(person, personStatement(roomId, memberPk)) };
}

/** The person key in a join request's person claim, when it signed this member key in this channel; else null. */
export async function checkPerson(c: unknown, roomId: string, memberPk: string): Promise<string | null> {
  if (!c || typeof c !== "object") return null;
  const claim = c as Partial<PersonClaim>;
  if (typeof claim.person !== "string" || !KEY_RE.test(claim.person) || typeof claim.proof !== "string" || claim.person === memberPk) return null;
  return (await verifyText(claim.person, claim.proof, personStatement(roomId, memberPk))) ? claim.person : null;
}
