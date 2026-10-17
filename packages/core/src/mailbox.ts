// A one-time mailbox at the relay, where two of one person's programs meet: the desktop app and a
// computer pairing with it (`kiwi pair`), or later two of their apps. Whoever starts makes a random
// secret and shows it as a code; the person pastes it on the other side. The relay only ever sees
// a mailbox id hashed from the secret, and boxes sealed under keys derived from it, so it can't read,
// forge or swap either side's message. Each slot is written once; the mailbox lives ten minutes.
//
//   desktop app                       relay                           computer (kiwi pair kp1-…)
//   shows kp1-<secret>
//                                     mailbox <id> slot a  ◄────────  PairAsk: its keys and name, signed
//   reads a, the person says yes
//   PairAnswer: the cert  ─────────►  mailbox <id> slot b  ────────►  stores the cert, deletes the box
//
// Shared by the CLI, the daemon, the desktop app and the relay (the routes check MAILBOX_ID_RE and
// the limits below), so nothing here touches the file system.

import { b64url, fromB64url, openWith, sealWith } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";
import { readMachineCert, certifyMachine, type MachineCert } from "./person.ts";

/** How long a mailbox lives after its first write. */
export const MAILBOX_TTL_MS = 10 * 60_000;
/** The most one slot holds (the sealed box, as sent). */
export const MAILBOX_MAX_BYTES = 64 * 1024;
export const MAILBOX_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const SLOTS = ["a", "b"] as const;
type Slot = (typeof SLOTS)[number];

const enc = new TextEncoder();
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

/** The relay refused or lost a mailbox call (status 0: it couldn't be reached). */
export class MailboxError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MailboxError";
  }
}

/** 256 random bits: the whole of what the code carries. */
export function newSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The mailbox's name at the relay: a hash of the secret, so knowing it gives nothing away. */
export async function mailboxId(secret: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(`kiwi-mailbox-id\n${secret}`))));
}

/** Each slot's own key, from the secret: a box for one slot never opens as the other's. */
async function slotKey(secret: string, slot: Slot): Promise<string> {
  const ikm = await crypto.subtle.importKey("raw", fromB64url(secret), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`kiwi-mailbox\n${slot}`) }, ikm, 256);
  return b64url(new Uint8Array(bits));
}

const ad = (id: string, slot: Slot) => `kiwi-mailbox\n${id}\n${slot}`;

export interface Mailbox {
  readonly id: string;
  /** Write a slot, once. */
  put(slot: Slot, value: unknown): Promise<void>;
  /** A slot's value, or null while it's empty (or the mailbox expired). */
  get<T>(slot: Slot): Promise<T | null>;
  /** Poll a slot until it's written, the time is up (null) or `signal` aborts (null). */
  wait<T>(slot: Slot, opts?: { timeoutMs?: number; everyMs?: number; signal?: AbortSignal }): Promise<T | null>;
  /** Delete the mailbox (both slots). Best effort: it expires anyway. */
  drop(): Promise<void>;
}

/** The mailbox a secret names, on `relay`. `fetchImpl` lets a caller with its own fetch (a test, a sandbox) use it. */
export async function openMailbox(relay: string, secret: string, fetchImpl: typeof fetch = fetch): Promise<Mailbox> {
  if (!SECRET_RE.test(secret)) throw new MailboxError(400, "that isn't a pairing code");
  const id = await mailboxId(secret);
  const url = (path = "") => new URL(`/v1/mailbox/${id}${path}`, relay);
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetchImpl(url(path), init);
    } catch (err) {
      throw new MailboxError(0, `couldn't reach ${relay}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const refused = async (res: Response): Promise<never> => {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new MailboxError(res.status, body.error ?? `the relay returned ${res.status}`);
  };
  const get = async <T>(slot: Slot): Promise<T | null> => {
    const res = await call(`/${slot}`);
    if (res.status === 404) return null;
    if (!res.ok) return refused(res);
    const { box } = (await res.json()) as { box?: unknown };
    const raw = typeof box === "string" ? await openWith(await slotKey(secret, slot), box, ad(id, slot)) : null;
    // Only someone holding the secret seals a box that opens. Anything else is the relay (or a stranger
    // who guessed the id) talking: treat it as an error, never as an answer.
    if (raw === null) throw new MailboxError(502, "the mailbox holds something this code didn't seal");
    return JSON.parse(raw) as T;
  };
  return {
    id,
    async put(slot, value) {
      const box = await sealWith(await slotKey(secret, slot), JSON.stringify(value), ad(id, slot));
      const res = await call(`/${slot}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ box }) });
      if (!res.ok) await refused(res);
    },
    get,
    async wait<T>(slot: Slot, opts: { timeoutMs?: number; everyMs?: number; signal?: AbortSignal } = {}): Promise<T | null> {
      const until = Date.now() + (opts.timeoutMs ?? MAILBOX_TTL_MS);
      for (;;) {
        if (opts.signal?.aborted) return null;
        const v = await get<T>(slot);
        if (v !== null) return v;
        if (Date.now() >= until) return null;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, Math.min(opts.everyMs ?? 1_500, Math.max(0, until - Date.now())));
          opts.signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
        });
      }
    },
    async drop() {
      await call("", { method: "DELETE" }).catch(() => {});
    },
  };
}

// ---------- pairing a computer with a person's app ----------

/** A pairing code: what the app shows and `kiwi pair` takes. */
const PAIR_PREFIX = "kp1-";

export const pairCode = (secret: string) => `${PAIR_PREFIX}${secret}`;

/** The secret in a pairing code, or null if it isn't one. */
export function readPairCode(code: string): string | null {
  const s = code.trim();
  if (!s.startsWith(PAIR_PREFIX)) return null;
  const secret = s.slice(PAIR_PREFIX.length);
  return SECRET_RE.test(secret) ? secret : null;
}

/** A computer asking to pair: its keys and name, signed by its key (`pk`), for this mailbox only. */
export interface PairAsk {
  kind: "kiwi-pair-ask";
  v: 1;
  mailbox: string;
  mxpk: string;
  label: string;
  /** "linux", "darwin", "win32"…: shown beside the label. */
  os: string;
  at: number;
  pk: string;
  sig: string;
}

/** The app's answer: the person's cert for that computer, and who they are. */
export interface PairAnswer {
  kind: "kiwi-pair-answer";
  v: 1;
  cert: MachineCert;
  person: { pk: string; xpk: string; name: string };
}

/** The computer's side, first half: ask to pair through `mailbox`. */
export async function askToPair(machine: Identity, mailbox: Mailbox, label: string, os: string): Promise<void> {
  if (!machine.xpk) throw new Error("this computer's key has no exchange key");
  const ask = await sign(machine, { kind: "kiwi-pair-ask" as const, v: 1 as const, mailbox: mailbox.id, mxpk: machine.xpk, label, os, at: Date.now() });
  await mailbox.put("a", ask);
}

/** The app's side: the ask in slot a, when it's a computer's own signature for this mailbox; else null. */
export async function readPairAsk(x: unknown, mailbox: Mailbox): Promise<PairAsk | null> {
  if (!x || typeof x !== "object") return null;
  const a = x as Partial<PairAsk>;
  if (a.kind !== "kiwi-pair-ask" || a.v !== 1 || a.mailbox !== mailbox.id) return null;
  if (typeof a.mxpk !== "string" || typeof a.label !== "string" || typeof a.os !== "string" || a.label.length > 64 || a.os.length > 32) return null;
  return (await verify(a)) ? (a as PairAsk) : null;
}

/** The app's side, once the person said yes: certify the computer and answer in slot b. */
export async function answerPair(person: Identity, mailbox: Mailbox, ask: PairAsk, label = ask.label): Promise<MachineCert> {
  if (!person.xpk) throw new Error("this person's key has no exchange key");
  const cert = await certifyMachine(person, { pk: ask.pk, xpk: ask.mxpk, label });
  const answer: PairAnswer = { kind: "kiwi-pair-answer", v: 1, cert, person: { pk: person.pk, xpk: person.xpk, name: person.name } };
  await mailbox.put("b", answer);
  return cert;
}

/** The computer's side, second half: the answer in slot b, when its cert is for this computer and signed by the person it names. */
export async function readPairAnswer(x: unknown, machinePk: string): Promise<PairAnswer | null> {
  if (!x || typeof x !== "object") return null;
  const a = x as Partial<PairAnswer>;
  if (a.kind !== "kiwi-pair-answer" || a.v !== 1 || !a.person || typeof a.person.pk !== "string" || typeof a.person.xpk !== "string" || typeof a.person.name !== "string") return null;
  const cert = await readMachineCert(a.cert);
  if (!cert || cert.machine !== machinePk || cert.pk !== a.person.pk) return null;
  return { kind: "kiwi-pair-answer", v: 1, cert, person: { pk: a.person.pk, xpk: a.person.xpk, name: a.person.name } };
}
