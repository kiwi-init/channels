import { b64url, openFrom, sealTo } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";

const MACHINE_VERBS = ["harnesses", "folders", "launch", "unpair"] as const;
export type MachineVerb = (typeof MACHINE_VERBS)[number];

export const ASK_MAX_BYTES = 4_096;
export const ASK_FRESH_MS = 2 * 60_000;
const ASK_INFO = "kiwi-machine-ask";
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export interface MachineAsk {
  kind: "kiwi-machine-ask";
  v: 1;
  machine: string;
  verb: MachineVerb;
  args: Record<string, unknown>;
  id: string;
  at: number;
  reply: string;
}

export interface MachineAnswer {
  kind: "kiwi-machine-answer";
  v: 1;
  id: string;
  result: unknown;
  pk: string;
  sig: string;
}

export type AskRefusal = "too-big" | "unsealed" | "malformed" | "unsigned" | "not-yours" | "stale" | "replayed";

const isVerb = (v: unknown): v is MachineVerb => typeof v === "string" && (MACHINE_VERBS as readonly string[]).includes(v);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function newAskId(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function makeAsk(
  person: Identity,
  machine: { pk: string; xpk: string },
  ask: { verb: MachineVerb; args: Record<string, unknown>; reply: string; id?: string },
  now = Date.now(),
): Promise<{ box: string; id: string }> {
  const id = ask.id ?? newAskId();
  if (!ID_RE.test(id)) throw new Error("an ask's id is 8 to 64 of A-Z a-z 0-9 _ -");
  if (!SECRET_RE.test(ask.reply)) throw new Error("an ask's reply is a mailbox secret");
  const body: MachineAsk = { kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: ask.verb, args: ask.args, id, at: now, reply: ask.reply };
  const box = await sealTo(machine.xpk, JSON.stringify(await sign(person, body)), ASK_INFO);
  if (box.length > ASK_MAX_BYTES) throw new Error(`an ask is at most ${ASK_MAX_BYTES} bytes sealed`);
  return { box, id };
}

function readAskBody(x: unknown): (MachineAsk & { pk: string; sig: string }) | null {
  if (!isRecord(x)) return null;
  const { kind, v, machine, verb, args, id, at, reply, pk, sig } = x;
  if (kind !== "kiwi-machine-ask" || v !== 1 || typeof machine !== "string" || !isVerb(verb) || !isRecord(args)) return null;
  if (typeof id !== "string" || !ID_RE.test(id) || typeof at !== "number" || !Number.isFinite(at) || typeof reply !== "string" || !SECRET_RE.test(reply)) return null;
  if (typeof pk !== "string" || typeof sig !== "string" || Object.keys(x).length !== 10) return null;
  return { kind, v, machine, verb, args, id, at, reply, pk, sig };
}

export async function readAsk(
  machine: Identity,
  box: string,
  expect: { person: string; now?: number; seen?: (id: string) => boolean },
): Promise<{ ok: true; ask: MachineAsk } | { ok: false; why: AskRefusal }> {
  if (box.length > ASK_MAX_BYTES) return { ok: false, why: "too-big" };
  const opened = machine.xsk ? await openFrom(machine.xsk, box, ASK_INFO) : null;
  if (opened === null) return { ok: false, why: "unsealed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(opened);
  } catch {
    // Sealed to us but not JSON: nothing to trust in it.
    return { ok: false, why: "malformed" };
  }
  const signed = readAskBody(parsed);
  if (!signed) return { ok: false, why: "malformed" };
  if (!(await verify(signed))) return { ok: false, why: "unsigned" };
  if (signed.pk !== expect.person || signed.machine !== machine.pk) return { ok: false, why: "not-yours" };
  if (Math.abs((expect.now ?? Date.now()) - signed.at) > ASK_FRESH_MS) return { ok: false, why: "stale" };
  if (expect.seen?.(signed.id)) return { ok: false, why: "replayed" };
  return { ok: true, ask: { kind: signed.kind, v: signed.v, machine: signed.machine, verb: signed.verb, args: signed.args, id: signed.id, at: signed.at, reply: signed.reply } };
}

export function signAnswer(machine: Identity, id: string, result: unknown): Promise<MachineAnswer> {
  return sign(machine, { kind: "kiwi-machine-answer" as const, v: 1 as const, id, result });
}

export async function readAnswer(x: unknown, expect: { machine: string; id: string }): Promise<{ result: unknown } | null> {
  if (!isRecord(x) || x.kind !== "kiwi-machine-answer" || x.v !== 1 || x.id !== expect.id || x.pk !== expect.machine || !("result" in x)) return null;
  if (Object.keys(x).length !== 6 || !(await verify(x))) return null;
  return { result: x.result };
}
