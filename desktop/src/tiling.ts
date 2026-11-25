import { execFile } from "node:child_process";

import type { TilingAsk, TilingEdge, TilingPicks, TilingSpot } from "./bridge.ts";
import { childEnv } from "./child-env.ts";

const JEV = "https://api.typesafe.ai/v1/systemone";
const ASK_MS = 8_000;
const KEY_MS = 5_000;
const RETRY_KEY_MS = 60_000;
const EDGES: ReadonlySet<string> = new Set<TilingEdge>(["left", "right", "top", "bottom"]);
const NAME = /^[\w:.-]{1,40}$/;

const name = (v: unknown): v is string => typeof v === "string" && NAME.test(v);
const share = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const list = <T>(v: unknown, most: number, ok: (x: unknown) => x is T): T[] | null => (Array.isArray(v) && v.length <= most && v.every(ok) ? v : null);

const isPane = (v: unknown): v is TilingAsk["panes"][number] => {
  const p = v as Record<string, unknown>;
  return !!p && name(p.id) && name(p.what) && share(p.x) && share(p.y) && share(p.w) && share(p.h);
};
const isSpot = (v: unknown): v is TilingSpot => {
  const s = v as Record<string, unknown>;
  return !!s && name(s.pane) && EDGES.has(s.edge as string) && (s.usual === undefined || s.usual === true);
};
const isPlace = (v: unknown): boolean => {
  const p = v as Record<string, unknown>;
  return !!p && name(p.beside) && (EDGES.has(p.edge as string) || p.edge === "fill");
};
const isPast = (v: unknown): v is TilingAsk["past"][number] => {
  const p = v as Record<string, unknown>;
  return !!p && name(p.what) && (p.by === "app" || p.by === "hand") && isPlace(p) && ["kept", "moved", "closed", "resized"].includes(p.then as string) && (p.to === undefined || isPlace(p.to));
};

export function tilingAsk(raw: unknown): TilingAsk | null {
  const a = raw as Record<string, unknown>;
  const screen = a?.screen as Record<string, unknown> | undefined;
  if (!screen || !Number.isFinite(screen.w) || !Number.isFinite(screen.h)) return null;
  const panes = list(a.panes, 16, isPane);
  const spots = list(a.spots, 64, isSpot);
  const kinds = list(a.kinds, 8, name);
  const past = list(a.past, 60, isPast);
  if (!panes || !spots || !kinds || !past || spots.length === 0 || kinds.length === 0) return null;
  if (!spots.every((s) => panes.some((p) => p.id === s.pane))) return null;
  return { screen: { w: Number(screen.w), h: Number(screen.h) }, panes, spots, kinds, past };
}

const SIDE: Record<TilingEdge, string> = { left: "on its left", right: "on its right", top: "above it", bottom: "below it" };
const BY: Record<TilingEdge | "fill", string> = { left: "left of", right: "right of", top: "above", bottom: "below", fill: "into" };
const AFTER = { moved: "moved it", closed: "closed it within seconds", resized: "resized it right away" } as const;

const placeOf = (p: { beside: string; edge: TilingEdge | "fill" }): string => (p.edge === "fill" ? "into an empty pane" : `${BY[p.edge]} the ${p.beside} pane`);

export function pastSaid(past: TilingAsk["past"][number]): string {
  if (past.by === "hand") return `The person put a ${past.what} pane ${placeOf(past)} themselves.`;
  const opened = `The app opened a ${past.what} pane ${placeOf(past)}`;
  if (past.then === "kept") return `${opened}, and the person kept it there.`;
  if (past.then === "moved") return `${opened}; within seconds the person moved it ${past.to ? placeOf(past.to) : "elsewhere"}.`;
  return `${opened}; the person ${AFTER[past.then]}.`;
}
const pct = (n: number): string => `${Math.round(n * 100)}%`;
export const spotId = (s: Pick<TilingSpot, "pane" | "edge">): string => `${s.pane}:${s.edge}`;

export function tilingRequest(ask: TilingAsk): object {
  const where = new Map(ask.panes.map((p) => [p.id, p]));
  const criteria = Object.fromEntries(
    ask.spots.map((s) => {
      const p = where.get(s.pane);
      const at = p ? `the ${p.what} pane (x ${pct(p.x)} to ${pct(p.x + p.w)}, y ${pct(p.y)} to ${pct(p.y + p.h)})` : "a pane";
      return [spotId(s), `Split ${at} and open the new pane ${SIDE[s.edge]}.`];
    }),
  );
  const usual = ask.spots.find((s) => s.usual);
  const fallback = usual ? `the app's usual spot, ${spotId(usual)}` : "the spot that leaves every pane roomiest";
  const questions = Object.fromEntries(
    ask.kinds.map((kind) => [
      kind,
      {
        type: "choice",
        instructions: `A new ${kind} pane is about to open on the screen described in \`panes\`. \`past\` tells, oldest first, where panes went and what this person did right after: a pane they moved shows where they wanted it, one they closed or resized shows the spot was wrong, one they kept shows it was fine, and one they placed themselves shows their own choice. Which spot would this person most likely want for the new ${kind} pane? Follow what they did with ${kind} panes first, then with similar panes. Only when \`past\` says nothing useful about such panes, choose ${fallback}.`,
        criteria,
      },
    ]),
  );
  return {
    model: "jev-latest",
    state: { screen: ask.screen, panes: ask.panes.map(({ what, x, y, w, h }) => ({ what, x, y, w, h })), past: ask.past.map(pastSaid) },
    questions,
  };
}

export function tilingPicks(ask: TilingAsk, reply: unknown): TilingPicks {
  const answers = ((reply as { answers?: unknown })?.answers ?? {}) as Record<string, { type?: unknown; choice?: unknown; probabilities?: Record<string, unknown> }>;
  const spots = new Map(ask.spots.map((s) => [spotId(s), s]));
  const out: TilingPicks = {};
  for (const kind of ask.kinds) {
    const got = answers[kind];
    const spot = typeof got?.choice === "string" ? spots.get(got.choice) : undefined;
    const p = got?.probabilities?.[String(got?.choice)];
    if (got?.type === "choice" && spot && typeof p === "number") out[kind] = { pane: spot.pane, edge: spot.edge, p };
  }
  return out;
}

function lookup(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: KEY_MS, env: childEnv() }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

let key: string | null = null;
let looked = 0;

async function jevKey(): Promise<string | null> {
  if (key) return key;
  if (Date.now() - looked < RETRY_KEY_MS) return null;
  looked = Date.now();
  key =
    process.env.TYPESAFE_API_KEY?.trim() ||
    (process.platform === "darwin"
      ? await lookup("security", ["find-generic-password", "-s", "kiwi-typesafe", "-a", "jev", "-w"])
      : process.platform === "linux"
        ? await lookup("secret-tool", ["lookup", "service", "kiwi-typesafe", "account", "jev"])
        : null);
  return key;
}

export async function tilingPick(raw: unknown): Promise<TilingPicks | null> {
  const ask = tilingAsk(raw);
  if (!ask) throw new Error("a tiling ask names the screen, its panes, the spots to choose from and the pane kinds");
  const auth = await jevKey();
  if (!auth) return null;
  try {
    const res = await fetch(JEV, {
      method: "POST",
      headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
      body: JSON.stringify(tilingRequest(ask)),
      signal: AbortSignal.timeout(ASK_MS),
    });
    if (res.status === 401) key = null;
    return res.ok ? tilingPicks(ask, await res.json()) : null;
  } catch {
    // Offline, slow or refused: the app places the pane the usual way.
    return null;
  }
}
