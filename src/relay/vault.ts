// A signed-in person's vault: their channels' identities and keys, encrypted on
// their own devices under a key the relay never holds (see src/vault.ts), so a
// new browser opens every channel after sign-in and a passkey touch, no QR.
//
// The relay keeps one opaque blob per person and never parses it. It orders
// writes: each PUT names the version it replaces, and a stale one is refused
// (409), so two devices saving at once merge instead of clobbering.
//
// And it only takes writes signed by the vault's writer key, which lives inside
// the encrypted vault: a stolen sign-in alone can't overwrite or delete it. The
// first save names the writer; later saves can hand over to a new one (when the
// vault key rotates). Someone who lost every passkey and their recovery code
// can only ask for a reset, which waits a day, shows on every device, and any
// device holding the writer key cancels by saving.

import { sha256Hex } from "../auth.ts";
import { canonical, verify } from "../identity.ts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import { attempt, describeRoutes, json, Request_, servePerson, signedInPerson, type Route } from "./http.ts";
import { BadRequest, Conflict, Forbidden, MethodNotAllowed, NotFound, TooLarge, TooMany, type Refusal } from "./failures.ts";
import type { Human } from "./human.ts";
import { fits, Present, VaultVersion } from "./schema.ts";

export interface VaultRecord {
  version: number;
  /** Ciphertext and public wrap metadata, as the person's devices wrote it. */
  blob: string;
  updated: number;
  /** The Ed25519 key every write must be signed by (its secret half is inside the vault). */
  writer: string;
  /** A reset someone asked for without the writer key: the vault is gone after this, unless a signed save cancels it. */
  resetAt?: number;
  /** When the recent writes happened: the rate limit, kept with the record so both relays agree. */
  recent: number[];
}

export interface VaultStore {
  get(user: string): Promise<VaultRecord | null>;
  /** Store `rec` if the current version is `expected` (0: none yet); else return what's there. Atomic. */
  put(user: string, expected: number, rec: VaultRecord): Promise<{ ok: true } | { ok: false; current: VaultRecord | null }>;
  /** Delete if the current version is `expected`. */
  remove(user: string, expected: number): Promise<boolean>;
}

/** Identities and keys for every channel a person is in: a few KB each. */
export const MAX_VAULT = 1024 * 1024;
/** Saving happens on create, join, leave and key rotation: a burst, then quiet. */
export const VAULT_WRITES = 30;
export const VAULT_WINDOW_MS = 10 * 60_000;
/** How long a reset without the writer key waits, so the person's devices can see it and cancel. */
export const VAULT_RESET_MS = 24 * 3600_000;

/** The compare-and-swap both stores run, given the record that's there now. */
export function vaultSwap(current: VaultRecord | null, expected: number): boolean {
  return (current?.version ?? 0) === expected;
}

/** What a writer signs to save (`hash` is the blob's SHA-256) or delete (`op`). */
export interface VaultAuth {
  user: string;
  expected: number;
  hash?: string;
  /** Hand writing over to this key (first save, or a rotation). */
  writer?: string;
  op?: "delete";
  pk: string;
  sig: string;
}

/** What a writer signs for a blob: its SHA-256, hex. */
export const blobHash = sha256Hex;

const version = (v: unknown) => (fits(VaultVersion, v) ? Effect.succeed(v) : Effect.fail(new BadRequest({ message: "version must be the vault version you read (0 for a new vault)" })));

/** The writer's signature over exactly this action, or a 403. */
const authorize = (auth: unknown, want: Omit<VaultAuth, "pk" | "sig">, signer: string) =>
  Effect.gen(function* () {
    const a = auth as Partial<VaultAuth> | null;
    const same = a && typeof a === "object" && canonical({ ...a, pk: undefined, sig: undefined }) === canonical(want);
    if (!same || a!.pk !== signer || !(yield* Effect.promise(() => verify(a!)))) return yield* new Forbidden({ message: "vault writes must be signed by the vault's writer key" });
  });

/** The record as it stands: a reset that has come due means there's no vault any more. */
async function live(store: VaultStore, user: string, now: number): Promise<VaultRecord | null> {
  const rec = await store.get(user);
  if (rec?.resetAt && rec.resetAt <= now) {
    await store.remove(user, rec.version);
    return null;
  }
  return rec;
}

function conflict(current: VaultRecord | null): Response {
  return Response.json(
    current
      ? { error: "the vault changed since you read it: read it again, merge, and save", tag: "VaultConflict", version: current.version, exists: true }
      : { error: "there's no vault any more: start a new one", tag: "VaultConflict", version: 0, exists: false },
    { status: 409 },
  );
}

// ---------- the routes ----------

/** People's vaults, as the adapter keeps them (bun:sqlite, or each person's Directory object). */
export class Vaults extends Context.Service<Vaults, VaultStore>()("kiwi/relay/Vaults") {}

type VaultGuard = "person";
type VaultRoute = Route<VaultGuard, string, never, Vaults | Human | Request_>;
/** The body as an object, or the 400 the vault has always sent. */
const vaultBody = Effect.gen(function* () {
  const b = yield* json<unknown>();
  if (b && typeof b === "object") return b as Record<string, unknown>;
  return yield* new BadRequest({ message: "bad json" });
});

const PATH = "/v1/me/vault";

const routes: VaultRoute[] = [
  {
    method: "GET",
    path: PATH,
    guard: "person",
    run: (user) =>
      Effect.gen(function* () {
        const store = yield* Vaults;
        const now = yield* Clock.currentTimeMillis;
        const rec = yield* attempt(() => live(store, user, now));
        if (!rec) return yield* new NotFound({ message: "no vault yet" });
        return { data: { version: rec.version, blob: rec.blob, updated: rec.updated, ...(rec.resetAt ? { resetAt: rec.resetAt } : {}) } };
      }),
  },
  {
    method: "PUT",
    path: PATH,
    guard: "person", // and, inside, the vault writer's signature over exactly this save
    run: (user) =>
      Effect.gen(function* () {
        const store = yield* Vaults;
        const now = yield* Clock.currentTimeMillis;
        const b = yield* vaultBody;
        const expected = yield* version(b.version);
        if (!fits(Present, b.blob)) return yield* new BadRequest({ message: "missing blob" });
        if (b.blob.length > MAX_VAULT) return yield* new TooLarge({ message: "the vault is larger than 1MB" });
        if (b.writer !== undefined && !fits(Present, b.writer)) return yield* new BadRequest({ message: "bad writer" });
        const handover = b.writer as string | undefined;
        const current = yield* attempt(() => live(store, user, now));
        // A stale version is a conflict, whoever signed it: a second setup on a vault that already
        // exists must hear "it exists" (409) and go unlock it, not a signature error. The version
        // is no secret (GET shows it) and nothing changes here.
        if ((current?.version ?? 0) !== expected) return { res: conflict(current) };
        // The first save names its writer and signs with it; every later one is signed by the current writer.
        if (!current && !handover) return yield* new BadRequest({ message: "a new vault names its writer key" });
        const signer = current?.writer ?? handover!;
        const blob = b.blob;
        const hash = yield* attempt(() => blobHash(blob));
        yield* authorize(b.auth, { user, expected, hash, ...(handover ? { writer: handover } : {}) }, signer);
        const recent = (current?.recent ?? []).filter((t) => now - t < VAULT_WINDOW_MS);
        if (recent.length >= VAULT_WRITES) return yield* new TooMany({ message: "too many vault saves; try again in a few minutes" });
        // A signed save is proof a device still holds the vault: it cancels any pending reset.
        const rec: VaultRecord = { version: expected + 1, blob, updated: now, writer: handover ?? signer, recent: [...recent, now] };
        const r = yield* attempt(() => store.put(user, expected, rec));
        if (!r.ok) return { res: conflict(r.current) };
        return { data: { version: rec.version } };
      }),
  },
  {
    method: "DELETE",
    path: PATH,
    guard: "person", // and the writer's signature, or a reset that waits a day
    run: (user) =>
      Effect.gen(function* () {
        const store = yield* Vaults;
        const now = yield* Clock.currentTimeMillis;
        const b = yield* vaultBody;
        const current = yield* attempt(() => live(store, user, now));
        if (!current) return yield* new NotFound({ message: "no vault yet" });
        if (b.reset === true) {
          // No writer key: lost every passkey and the recovery code. Wait, so the person's devices can see it and cancel.
          const resetAt = current.resetAt ?? now + VAULT_RESET_MS;
          if (!current.resetAt && !(yield* attempt(() => store.put(user, current.version, { ...current, resetAt }))).ok) return yield* new Conflict({ message: "the vault changed; try again" });
          return { data: { resetAt } };
        }
        const expected = yield* version(b.version);
        yield* authorize(b.auth, { user, expected, op: "delete" }, current.writer);
        if (!(yield* attempt(() => store.remove(user, expected)))) {
          return { res: Response.json({ error: "the vault changed since you read it", tag: "VaultConflict", version: current.version }, { status: 409 }) };
        }
        return { data: { removed: true } };
      }),
  },
];

const guards: Record<VaultGuard, Effect.Effect<string, Refusal, Human | Request_>> = { person: signedInPerson("this relay has no sign-in") };

/** The vault's rows, for the route-table test. */
export const vaultRouteTable = describeRoutes(routes);

// Another method: sign-in first, as always, then the 405.
const otherwise = Effect.flatMap(guards.person, () => Effect.fail(new MethodNotAllowed({ message: "use GET, PUT or DELETE" })));

/** Routes under /v1/me/vault, run with the relay's people services; null when the path isn't one of them. */
export async function onVaultHttp(req: Request, people: Context.Context<Vaults | Human>): Promise<Response | null> {
  if (new URL(req.url).pathname !== PATH) return null;
  return servePerson(req, routes, guards, otherwise, people);
}
