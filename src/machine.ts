// This computer's link to its person (see relay/machines.ts for the relay side).
// `kiwi setup` makes a machine key, the person confirms it in their browser,
// and from then on agents started here join already vouched for as theirs.
//
// The relay requests are Effects (machineFx), refused with MachineRefused; the
// Promise functions run them for callers outside Effect. machine.json itself is
// read and written in place, like the rest of ~/.kiwi.

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { signRequest } from "./auth.ts";
import { settle, Unreachable } from "./client.ts";
import { home, writePrivate } from "./config.ts";
import { generateIdentity, sign, signText, type Identity } from "./identity.ts";
import { MACHINE_SCOPE, vouchStatement } from "./vouch.ts";

export { machineCode } from "./vouch.ts";

export interface MachineFile {
  identity: Identity;
  label: string;
  relay: string;
  /** Set once the person confirmed: who this computer vouches as. */
  linked?: { name: string | null; at: number };
}

const path = () => join(home(), "machine.json");

export function loadMachine(): MachineFile | null {
  try {
    return existsSync(path()) ? (JSON.parse(readFileSync(path(), "utf8")) as MachineFile) : null;
  } catch {
    return null;
  }
}

export function saveMachine(m: MachineFile): void {
  writePrivate(path(), JSON.stringify(m, null, 2) + "\n");
}

export function forgetMachine(): void {
  rmSync(path(), { force: true });
}

/** A fresh, unlinked machine key, labelled after this computer. */
export async function newMachine(relay: string): Promise<MachineFile> {
  const label = (hostname().replace(/\.local$/, "") || "This computer").slice(0, 60);
  return { identity: await generateIdentity("machine"), label, relay };
}

/** The relay refused a computer's request: its text, as the relay said it. */
export class MachineRefused extends Data.TaggedError("MachineRefused")<{ readonly status: number; readonly message: string }> {}

/** One request to a computer's route, signed by its key (all but asking to be linked). */
const machineCall = <T>(m: MachineFile, method: string, p: string, body?: object) =>
  Effect.gen(function* () {
    const text = body ? JSON.stringify(body) : "";
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (method !== "POST" || p !== "/v1/machines") headers.authorization = `Bearer ${yield* Effect.promise(() => signRequest(m.identity, MACHINE_SCOPE, method, p, text))}`;
    const res = yield* Effect.tryPromise({
      try: (signal) => fetch(new URL(p, m.relay), { method, headers, body: method === "GET" || method === "DELETE" ? undefined : text, signal }),
      catch: (cause) => new Unreachable({ cause }),
    });
    const json = (yield* Effect.promise(() => res.json().catch(() => ({})))) as T & { error?: string };
    if (!res.ok) return yield* new MachineRefused({ status: res.status, message: json.error ?? `relay returned ${res.status}` });
    return json as T;
  });

/** This computer's requests to the relay, as Effects. */
export const machineFx = {
  /** Ask the relay to link this computer; the person confirms in their browser. */
  register: Effect.fn("Machine.register")(function* (m: MachineFile) {
    const signed = yield* Effect.promise(() => sign(m.identity, { label: m.label, ts: Date.now() }));
    return yield* machineCall<{ status: string; code?: string }>(m, "POST", "/v1/machines", signed);
  }),
  status: (m: MachineFile) => machineCall<{ status: "pending" | "linked" | "expired"; name: string | null }>(m, "GET", `/v1/machines/${m.identity.pk}`),
  unlink: (m: MachineFile) => machineCall<unknown>(m, "DELETE", `/v1/machines/${m.identity.pk}`),
};

/** As Promises: what fetch threw for a relay out of reach, an Error with the relay's text for a refusal. */
const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromiseExit(effect).then(settle);

/** Ask the relay to link this computer; the person confirms in their browser. */
export function registerMachine(m: MachineFile): Promise<{ status: string; code?: string }> {
  return run(machineFx.register(m));
}

export function machineStatus(m: MachineFile): Promise<{ status: "pending" | "linked" | "expired"; name: string | null }> {
  return run(machineFx.status(m));
}

export function unlinkMachine(m: MachineFile): Promise<unknown> {
  return run(machineFx.unlink(m));
}

/** The link the person opens to confirm this computer. */
export function linkUrl(m: MachineFile): string {
  return `${m.relay}/#link=${m.identity.pk}`;
}

/** This computer's signature vouching for one agent key in one channel. */
export async function vouchFor(m: MachineFile, roomId: string, agentPk: string): Promise<{ pk: string; sig: string }> {
  return { pk: m.identity.pk, sig: await signText(m.identity, vouchStatement(roomId, agentPk)) };
}
