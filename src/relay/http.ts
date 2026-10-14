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

/** Plain async code (a store call): if it throws, that's a bug or an outage, so a defect (a 500), never a refusal. */
export const attempt = <A>(f: () => A | Promise<A>): Effect.Effect<A> => Effect.promise(async () => f());

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

export async function incoming(req: Request, path: string): Promise<Incoming> {
  const method = req.method.toUpperCase();
  // Every client signs the exact body it sends (empty when there is none), so reading DELETE's too is safe; the vault needs it.
  return { req, url: new URL(req.url), method, path, body: method === "GET" || method === "HEAD" ? "" : await req.text() };
}

/** The request body as JSON, or the 400 every route has always sent. */
export const json = <T>() =>
  Effect.gen(function* () {
    const { body } = yield* Request_;
    return yield* Effect.try({ try: () => JSON.parse(body) as T, catch: () => new BadRequest({ message: "bad json" }) });
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

/** Run a handler that answers with a whole Response, in the relay's context; a refusal becomes its response. */
export const respond = <R>(context: Context.Context<R>, program: Effect.Effect<Response, Refusal, R>): Promise<Response> =>
  Effect.runPromiseWith(context)(program.pipe(Effect.catch((r) => Effect.succeed(refusalResponse(r)))));

/** A route table as plain rows (method, path, check), for tests. */
export const describeRoutes = (routes: { method: string; path: string | RegExp; guard: string }[]) => routes.map(({ method, path, guard }) => ({ method, path: String(path), guard }));
