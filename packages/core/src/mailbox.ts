// A one-time mailbox at the relay, where two of one person's programs meet: the desktop app and a
// computer it asks to launch an agent, or a device enrolling with the app. Whoever starts makes a
// random secret; the relay only ever sees a mailbox id hashed from it, and boxes sealed under keys
// derived from it, so it can't read, forge or swap either side's message. Each slot is written once;
// the mailbox lives ten minutes.
//
// Shared by the CLI, the daemon, the desktop app and the relay (the routes check MAILBOX_ID_RE and
// the limits below), so nothing here touches the file system.

import { b64url, fromB64url, openWith, sealWith } from "./crypto.ts";

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
class MailboxError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly lasting = false,
  ) {
    super(message);
    this.name = "MailboxError";
  }

  /** The network or the relay failing for a moment: asking again may work. */
  get transient(): boolean {
    return !this.lasting && (this.status === 0 || this.status === 429 || this.status >= 500);
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
  if (!SECRET_RE.test(secret)) throw new MailboxError(400, "that isn't a mailbox secret");
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
    if (raw === null) throw new MailboxError(502, "the mailbox holds something this code didn't seal", true);
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
        let failed: MailboxError | null = null;
        try {
          const v = await get<T>(slot);
          if (v !== null) return v;
        } catch (err) {
          if (!(err instanceof MailboxError) || !err.transient) throw err;
          failed = err;
        }
        if (Date.now() >= until) {
          if (failed) throw failed;
          return null;
        }
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
