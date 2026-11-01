// What every relay route table shares: the request as a service, the tagged
// refusals (failures.ts), and a dispatcher that runs a route's declared check
// before its handler. The room's routes are in route.ts; the pairing mailbox's
// in mailbox.ts.

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import { BadRequest, refusalResponse, type Refusal } from "./failures.ts";

// ---------- the relay's services, built once ----------

/**
 * An adapter's Layer, built once (per Bun relay, per Durable Object) into the
 * context every request then runs with. The Layers are plain values, so this
 * costs nothing per request.
 *
 * And the scheduler never slips other work in between two steps: a room reads,
 * checks and writes with no await in between, which is what keeps a Durable
 * Object's request atomic (it only interleaves at awaits), as it was before.
 */
export function buildContext<R>(layer: Layer.Layer<R>): Context.Context<R> {
  return Effect.runSync(Effect.scoped(Layer.build(layer))).pipe(Context.add(References.PreventSchedulerYield, true));
}

/** Effect's clock reading `now`: the Bun relay's tests move it across midnight and past expiry. */
function clockAt(now: () => number): Clock.Clock {
  const real = Context.getUnsafe(Context.empty(), Clock.Clock);
  const nanos = () => BigInt(now()) * 1_000_000n;
  return {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: (d) => real.sleep(d),
  };
}

/** The clock as a Layer: `now` when given, else Effect's own. */
export const clockLayer = (now?: () => number) => (now ? Layer.succeed(Clock.Clock, clockAt(now)) : Layer.empty);

/** The request, read once. */
export interface Incoming {
  req: Request;
  url: URL;
  method: string;
  path: string;
  body: string;
}
export class Request_ extends Context.Service<Request_, Incoming>()("kiwi/relay/Request") {}

export const MAX_REQUEST_BYTES = 1 << 20;

export async function readText(body: ReadableStream<Uint8Array> | null, max: number, declared?: string | null): Promise<string | null> {
  if (Number(declared ?? 0) > max) return null;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return new TextDecoder().decode(out);
}

export async function incoming(req: Request, path: string): Promise<Incoming | null> {
  const method = req.method.toUpperCase();
  if (method === "PUT" && path.startsWith("/blobs/")) return { req, url: new URL(req.url), method, path, body: "" };
  if (method === "GET" || method === "HEAD") return { req, url: new URL(req.url), method, path, body: "" };
  // Every client signs the exact body it sends (empty when there is none), so reading DELETE's too is safe; the vault needs it.
  const body = await readText(req.body, MAX_REQUEST_BYTES, req.headers.get("content-length"));
  return body === null ? null : { req, url: new URL(req.url), method, path, body };
}

export async function readCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const out = new Uint8Array(max);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.slice(0, n);
    if (n + value.length > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    out.set(value, n);
    n += value.length;
  }
}

/** The request body as a JSON object, or the 400 every route has always sent. */
export const json = <T>(): Effect.Effect<T, BadRequest, Request_> =>
  Effect.gen(function* () {
    const { body } = yield* Request_;
    return yield* Effect.try({
      try: () => {
        const parsed: unknown = JSON.parse(body);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad json");
        return parsed as T;
      },
      catch: () => new BadRequest({ message: "bad json" }),
    });
  });

/** What a handler answers: data to send as JSON (with effects for the adapter), or a whole response. */
export type Reply<Fx> = { data: unknown; fx?: Fx } | { res: Response; fx?: Fx };

/** One row: a method, a path, the check it needs, and the handler that runs once the check passes. */
export interface Route<G extends string, W, Fx, R> {
  method: string;
  path: string | RegExp;
  guard: G;
  run: (who: W, match: RegExpExecArray) => Effect.Effect<Reply<Fx>, Refusal, R>;
}

const matches = (r: { method: string; path: string | RegExp }, method: string, path: string): RegExpExecArray | null => {
  if (r.method !== method) return null;
  if (typeof r.path === "string") return r.path === path ? /^.*$/s.exec(path) : null;
  return r.path.exec(path);
};

/** Find the route, run its check, then its handler; `otherwise` when no row matches. */
export const dispatch = <G extends string, W, Fx, R>(
  routes: Route<G, W, Fx, R>[],
  guards: Record<G, Effect.Effect<W, Refusal, R>>,
  otherwise: Effect.Effect<Reply<Fx>, Refusal, R | Request_>,
): Effect.Effect<Reply<Fx>, Refusal, R | Request_> =>
  Effect.gen(function* () {
    const { method, path } = yield* Request_;
    for (const r of routes) {
      const m = matches(r, method, path);
      if (!m) continue;
      const who = yield* guards[r.guard];
      return yield* r.run(who, m);
    }
    return yield* otherwise;
  });

/** A reply as a response; a refusal as the same { error, tag } and status it has always been. */
export const answer = <Fx, R>(program: Effect.Effect<Reply<Fx>, Refusal, R>): Effect.Effect<{ res: Response; fx?: Fx }, never, R> =>
  program.pipe(
    Effect.map((reply) => ("res" in reply ? reply : { res: Response.json(reply.data), fx: reply.fx })),
    Effect.catch((r) => Effect.succeed({ res: refusalResponse(r) })),
  );

/** A route table as plain rows (method, path, check), for tests. */
export const describeRoutes = (routes: { method: string; path: string | RegExp; guard: string }[]) => routes.map(({ method, path, guard }) => ({ method, path: String(path), guard }));
