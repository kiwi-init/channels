// What every relay route table shares: the request as a service, the tagged
// refusals (failures.ts), and a dispatcher that runs a route's declared check
// before its handler. The room's routes are in route.ts; a person's in
// devices.ts, vault.ts and machines.ts.

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import { tagForStatus, type ErrorTag } from "../errors.ts";
import { BadRequest, refusalResponse, Refused, type Refusal } from "./failures.ts";
import { HUMAN_HEADER, type HumanAuth } from "./human.ts";

/** Refuse with a status and text, and a tag when the status alone doesn't say what it means. */
export const refuse = (status: number, message: string, tag?: ErrorTag) => Effect.fail(new Refused({ status, message, tag: tag ?? tagForStatus(status) }));

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

/** Run a handler that answers with a whole Response; a refusal becomes its response. */
export const respond = (program: Effect.Effect<Response, Refusal>): Promise<Response> =>
  Effect.runPromise(program.pipe(Effect.catch((r) => Effect.succeed(refusalResponse(r)))));

/** A route table as plain rows (method, path, check), for tests. */
export const describeRoutes = (routes: { method: string; path: string | RegExp; guard: string }[]) => routes.map(({ method, path, guard }) => ({ method, path: String(path), guard }));

// ---------- a signed-in person's routes ----------

/** Sign-in as the person routes see it: who verifies sessions (null: this relay has none), and the time. */
export class SignIn extends Context.Service<SignIn, { human: HumanAuth | null; now: number }>()("kiwi/relay/SignIn") {}

/**
 * The signed-in person behind a request. `noSignIn` is the 404 each area has
 * always given on a relay without sign-in (its text is API too).
 */
export const signedInPerson = (noSignIn: string) =>
  Effect.gen(function* () {
    const { human } = yield* SignIn;
    const { req } = yield* Request_;
    if (!human) return yield* refuse(404, noSignIn);
    const user = yield* Effect.promise(() => human.verify(req.headers.get(HUMAN_HEADER) ?? ""));
    if (!user) return yield* refuse(401, "sign in first", "SignInRequired");
    return user;
  });

/** Run a person route table for one request; the answer as a Response. */
export async function servePerson<G extends string, W, R>(
  req: Request,
  routes: Route<G, W, never, R | SignIn | Request_>[],
  guards: Record<G, Effect.Effect<W, Refusal, R | SignIn | Request_>>,
  otherwise: Effect.Effect<Reply<never>, Refusal, R | SignIn | Request_>,
  provide: (e: Effect.Effect<{ res: Response }, never, R | SignIn | Request_>) => Effect.Effect<{ res: Response }, never, SignIn | Request_>,
  signIn: { human: HumanAuth | null; now: number },
): Promise<Response> {
  const program = answer(dispatch(routes, guards, otherwise)).pipe(
    provide,
    Effect.provideService(SignIn, signIn),
    Effect.provideService(Request_, await incoming(req, new URL(req.url).pathname)),
  );
  return (await Effect.runPromise(program)).res;
}
