import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { signRequest } from "../auth.ts";
import type { Identity } from "../identity.ts";
import { RelayError, Unreachable, type Refusal } from "./errors.ts";

export type HumanSession = () => Promise<string | null>;

export interface CallInit {
  method?: string;
  body?: string;
  identity?: Identity;
  human?: string | null;
}

type Conditional<T> = { readonly fresh: true; readonly etag: string | null; readonly data: T } | { readonly fresh: false };

export interface RelayApi {
  readonly call: <T>(relay: string, roomId: string, path: string, init?: CallInit, params?: Record<string, string | number>) => Effect.Effect<T, Refusal>;
  readonly conditional: <T>(relay: string, roomId: string, path: string, etag: string | null, init?: CallInit, params?: Record<string, string | number>) => Effect.Effect<Conditional<T>, Refusal>;
  readonly config: (relay: string) => Effect.Effect<RelayConfig, Unreachable>;
  readonly blob: (relay: string, roomId: string, id: string, identity: Identity, put?: Uint8Array<ArrayBuffer>) => Effect.Effect<Uint8Array<ArrayBuffer>, Refusal>;
}

export class Relay extends Context.Service<Relay, RelayApi>()("kiwi/client/Relay") {}

const EXPIRED_SIGNATURE = "bad or expired signature";

const REQUEST_MS = 30_000;

const reach = (url: URL, init: RequestInit) => Effect.tryPromise({ try: (signal) => fetch(url, { ...init, signal }), catch: (cause) => new Unreachable({ cause, url: url.origin }) });

const inTime = <A, E>(url: URL, request: Effect.Effect<A, E>): Effect.Effect<A, E | Unreachable> =>
  Effect.timeoutOrElse(request, {
    duration: REQUEST_MS,
    orElse: () => Effect.fail(new Unreachable({ cause: new Error(`no answer in ${REQUEST_MS / 1000}s`), url: url.origin })),
  });

const answered = <T>(res: Response) =>
  Effect.flatMap(
    Effect.promise(() => res.json().catch(() => ({})) as Promise<T & { error?: string; tag?: string; retryAfter?: number }>),
    (json): Effect.Effect<T, RelayError> =>
      res.ok ? Effect.succeed(json) : Effect.fail(new RelayError(res.status, json.error ?? `the relay returned ${res.status}`, json.tag, res.headers.get("retry-after") ?? json.retryAfter)),
  );

const expired = (err: Refusal) => err instanceof RelayError && err.status === 401 && err.message === EXPIRED_SIGNATURE;

export const fetchRelay: RelayApi = {
  call: <T>(relay: string, roomId: string, path: string, init: CallInit = {}, params: Record<string, string | number> = {}) =>
    Effect.flatMap(fetchRelay.conditional<T>(relay, roomId, path, null, init, params), (a) => (a.fresh ? Effect.succeed(a.data) : Effect.die(new Error("not modified")))),
  conditional: <T>(relay: string, roomId: string, path: string, etag: string | null, init: CallInit = {}, params: Record<string, string | number> = {}) =>
    Effect.suspend(() => {
      const u = new URL(`/v1/rooms/${roomId}${path}`, relay);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ?? "";
      const { identity, human } = init;
      const once = Effect.gen(function* () {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (identity) headers.authorization = `Bearer ${yield* Effect.promise(() => signRequest(identity, roomId, method, path + u.search, body))}`;
        if (human) headers["x-human-token"] = human;
        if (etag) headers["if-none-match"] = etag;
        const res = yield* reach(u, { method, body: method === "GET" || method === "DELETE" ? undefined : body, headers });
        if (etag && res.status === 304) return { fresh: false } as const;
        const data = yield* answered<T>(res);
        return { fresh: true, etag: res.headers.get("etag"), data } as const;
      });
      return Effect.retry(inTime(u, once), { times: 1, while: (err) => !!identity && expired(err) });
    }),
  config: (relay) =>
    Effect.suspend(() => inTime(new URL(relay), reach(new URL("/v1/config", relay), {}))).pipe(
      Effect.flatMap((res) => (res.ok ? Effect.promise(() => res.json() as Promise<RelayConfig>) : Effect.succeed({ workosClientId: null }))),
    ),
  blob: (relay, roomId, id, identity, put) =>
    Effect.suspend(() => {
      const path = `/blobs/${id}`;
      const method = put ? "PUT" : "GET";
      const once = Effect.gen(function* () {
        const authorization = `Bearer ${yield* Effect.promise(() => signRequest(identity, roomId, method, path, ""))}`;
        const res = yield* reach(new URL(`/v1/rooms/${roomId}${path}`, relay), { method, body: put, headers: put ? { authorization, "content-type": "application/octet-stream" } : { authorization } });
        if (!res.ok) return yield* answered<never>(res);
        return new Uint8Array(yield* Effect.tryPromise({ try: () => res.arrayBuffer(), catch: (cause) => new Unreachable({ cause }) }));
      });
      return Effect.retry(inTime(new URL(relay), once), { times: 1, while: expired });
    }),
};

export const callRelay = <T>(relay: string, roomId: string, path: string, init?: CallInit, params?: Record<string, string | number>) =>
  Effect.gen(function* () {
    return yield* (yield* Relay).call<T>(relay, roomId, path, init, params);
  });

export interface OfflineReadsApi {
  note(why: string): void;
}

export const OfflineReads = Context.Reference<OfflineReadsApi | null>("kiwi/client/OfflineReads", { defaultValue: () => null });

export const relayDown = (err: unknown): boolean => err instanceof Unreachable || (err instanceof RelayError && (err.status >= 500 || err.status === 429));

export const downWhy = (err: unknown): string => {
  const e = err instanceof Unreachable ? err.cause : err;
  return e instanceof Error ? e.message : String(e);
};

export const callUnlessUnchanged = <T>(relay: string, roomId: string, what: Remembered, path: string, init?: CallInit, params?: Record<string, string | number>) =>
  Effect.gen(function* () {
    const memory = answerMemory;
    const kept = memory?.get(roomId, what) ?? null;
    const offline = yield* OfflineReads;
    const got = yield* (yield* Relay).conditional<T>(relay, roomId, path, kept?.etag ?? null, init, params).pipe(
      Effect.catchIf(
        (err) => !!offline && !!kept && relayDown(err),
        (err) => Effect.sync(() => (offline?.note(downWhy(err)), { fresh: false } as const)),
      ),
    );
    if (!got.fresh) return kept!.data as T;
    const etag = got.etag;
    if (etag && memory) yield* Effect.ignore(Effect.try({ try: () => memory.set(roomId, what, { etag, data: got.data }), catch: (err) => err }));
    return got.data;
  });

export function settle<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isSuccess(exit)) return exit.value;
  const err = Cause.squash(exit.cause);
  throw err instanceof Unreachable ? err.cause : err;
}

export const run = <A, E>(effect: Effect.Effect<A, E, Relay>): Promise<A> => Effect.runPromiseExit(Effect.provideService(effect, Relay, fetchRelay)).then(settle);

export const runUntil = <E>(effect: Effect.Effect<void, E, Relay>, signal?: AbortSignal): Promise<void> =>
  Effect.runPromiseExit(Effect.provideService(effect, Relay, fetchRelay), { signal }).then((exit) =>
    signal?.aborted && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause) ? undefined : settle(exit),
  );

type Remembered = "members" | "info";

export interface AnswerMemory {
  get(room: string, what: Remembered): { etag: string; data: unknown } | null;
  set(room: string, what: Remembered, answer: { etag: string; data: unknown }): void;
}
let answerMemory: AnswerMemory | null = null;
export function keepAnswersIn(memory: AnswerMemory | null): void {
  answerMemory = memory;
}

export interface RelayConfig {
  workosClientId: string | null;
  dev?: boolean;
  githubClientId?: string;
  githubSignIn?: boolean;
}

export const fx = {
  relayConfig: Effect.fn("relayConfig")(function* (relay: string) {
    return yield* (yield* Relay).config(relay);
  }),
};

export function relayConfig(relay: string): Promise<RelayConfig> {
  return run(fx.relayConfig(relay));
}
