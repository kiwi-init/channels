import type { Pane } from "../terminals/plugin.ts";

export type Screen = "ready" | "trust" | "starting";

export type Typed = "typed" | "failed" | "late";

export interface TypeOptions {
  startingMs?: number;
  trustMs?: number;
  everyMs?: number;
  now?: () => number;
}

const STARTING_MS = 2 * 60_000;
const TRUST_MS = 30 * 60_000;
const EVERY_MS = 500;
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export async function typeWhenReady(pane: Pane, text: string, screenOf: (text: string) => Screen, opts: TypeOptions = {}): Promise<Typed> {
  const now = opts.now ?? Date.now;
  const startingMs = opts.startingMs ?? STARTING_MS;
  const latest = now() + (opts.trustMs ?? TRUST_MS);
  let deadline = now() + startingMs;
  for (;;) {
    const shown = pane.screen();
    const screen = shown === null ? "starting" : screenOf(shown.replace(ESCAPES, ""));
    if (screen === "ready") return pane.type(text) && pane.enter() ? "typed" : "failed";
    if (screen === "trust") deadline = Math.min(now() + startingMs, latest);
    if (now() > deadline) return "late";
    await Bun.sleep(opts.everyMs ?? EVERY_MS);
  }
}
