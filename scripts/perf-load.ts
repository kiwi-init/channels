import type { BrowserContext, Page } from "playwright-core";

export type LoadKind = "switch" | "reload" | "key";

export interface LoadRun {
  kind: LoadKind;
  startMs: number;
  endMs: number;
}

const KEY = "__kiwiLoad";
const SWITCH_BUTTONS = 'nav[aria-label="Views"] button, section[aria-label="Rooms"] button';

export function loadUnitsFrom(env: Record<string, string | undefined>): number {
  const raw = env.PERF_LOAD_UNITS?.trim() ?? "";
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`PERF_LOAD_UNITS must be a whole number of loop iterations, not ${raw}`);
  return n;
}

export function loadInPage({ units, buttons }: { units: number; buttons: string }): void {
  const runs: { kind: string; startMs: number; endMs: number; x: number }[] = [];
  Reflect.set(window, "__kiwiLoad", runs);
  const burn = (kind: string): void => {
    const startMs = performance.now();
    let x = 0;
    for (let i = 0; i < units; i++) x = (x + i * 31) % 1_000_003;
    runs.push({ kind, startMs, endMs: performance.now(), x });
  };
  document.addEventListener(
    "click",
    (e) => {
      if (e.target instanceof Element && e.target.closest(buttons)) burn("switch");
    },
    true,
  );
  document.addEventListener("DOMContentLoaded", () => burn("reload"));
  document.addEventListener("keydown", () => burn("key"), true);
}

export async function installLoad(context: BrowserContext, units: number): Promise<void> {
  if (units > 0) await context.addInitScript(loadInPage, { units, buttons: SWITCH_BUTTONS });
}

export async function loadRuns(page: Page): Promise<LoadRun[]> {
  const raw: unknown = await page.evaluate((key) => Reflect.get(window, key), KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: unknown) => {
    if (!r || typeof r !== "object") return [];
    const kind: unknown = Reflect.get(r, "kind");
    const startMs: unknown = Reflect.get(r, "startMs");
    const endMs: unknown = Reflect.get(r, "endMs");
    return (kind === "switch" || kind === "reload" || kind === "key") && typeof startMs === "number" && typeof endMs === "number" ? [{ kind, startMs, endMs }] : [];
  });
}

export function requireInside(runs: readonly LoadRun[], kind: LoadKind, fromMs: number, toMs: number, what: string, atLeast = 1): void {
  const inside = runs.filter((r) => r.kind === kind && r.startMs >= fromMs && r.endMs <= toMs);
  if (inside.length < atLeast) throw new Error(`the injected load for ${what} ran ${inside.length} time(s) inside its window ${Math.round(fromMs)}-${Math.round(toMs)} ms, ${atLeast} needed`);
}
