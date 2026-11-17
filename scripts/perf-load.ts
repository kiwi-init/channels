import type { BrowserContext, Page } from "playwright-core";

export type LoadKind = "switch" | "reload" | "key";

export interface LoadRun {
  kind: LoadKind;
  view: string;
  startMs: number;
  endMs: number;
}

export interface Loads {
  switch: Record<string, number>;
  key: number;
  reload: number;
}

const KEY = "__kiwiLoad";
const SWITCH_BUTTONS = 'nav[aria-label="Views"] button, section[aria-label="Rooms"] button';

function units(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name]?.trim() ?? "";
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a whole number of loop iterations, not ${raw}`);
  return n;
}

export function loadsFrom(env: Record<string, string | undefined>, views: Record<string, string>): Loads {
  const all = units(env, "PERF_LOAD_UNITS", 0);
  return {
    switch: Object.fromEntries(Object.keys(views).map((v) => [v, units(env, `PERF_LOAD_SWITCH_${v.toUpperCase()}`, all)])),
    key: units(env, "PERF_LOAD_KEY", all),
    reload: units(env, "PERF_LOAD_RELOAD", all),
  };
}

export const anyLoad = (loads: Loads): boolean => loads.key > 0 || loads.reload > 0 || Object.values(loads.switch).some((n) => n > 0);

export function loadInPage({ buttons, views, key, reload }: { buttons: string; views: { view: string; label: string; units: number }[]; key: number; reload: number }): void {
  const runs: { kind: string; view: string; startMs: number; endMs: number; x: number }[] = [];
  Reflect.set(window, "__kiwiLoad", runs);
  const flat = (s: string) => s.replace(/\s+/g, "");
  const burn = (kind: string, view: string, n: number): void => {
    if (n <= 0) return;
    const startMs = performance.now();
    let x = 0;
    for (let i = 0; i < n; i++) x = (x + i * 31) % 1_000_003;
    runs.push({ kind, view, startMs, endMs: performance.now(), x });
  };
  document.addEventListener(
    "click",
    (e) => {
      const b = e.target instanceof Element ? e.target.closest(buttons) : null;
      if (!b) return;
      const text = flat(b.textContent ?? "");
      const hit = views.find((v) => text.startsWith(flat(v.label)));
      if (hit) burn("switch", hit.view, hit.units);
    },
    true,
  );
  document.addEventListener("DOMContentLoaded", () => burn("reload", "", reload));
  document.addEventListener("keydown", () => burn("key", "", key), true);
}

export async function installLoad(context: BrowserContext, loads: Loads, views: Record<string, string>): Promise<void> {
  if (!anyLoad(loads)) return;
  await context.addInitScript(loadInPage, {
    buttons: SWITCH_BUTTONS,
    views: Object.entries(views).map(([view, label]) => ({ view, label, units: loads.switch[view] ?? 0 })),
    key: loads.key,
    reload: loads.reload,
  });
}

export async function loadRuns(page: Page): Promise<LoadRun[]> {
  const raw: unknown = await page.evaluate((key) => Reflect.get(window, key), KEY);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r: unknown) => {
    if (!r || typeof r !== "object") return [];
    const kind: unknown = Reflect.get(r, "kind");
    const view: unknown = Reflect.get(r, "view");
    const startMs: unknown = Reflect.get(r, "startMs");
    const endMs: unknown = Reflect.get(r, "endMs");
    return (kind === "switch" || kind === "reload" || kind === "key") && typeof view === "string" && typeof startMs === "number" && typeof endMs === "number" ? [{ kind, view, startMs, endMs }] : [];
  });
}

export function requireInside(runs: readonly LoadRun[], kind: LoadKind, view: string, fromMs: number, toMs: number, what: string, atLeast = 1): void {
  const inside = runs.filter((r) => r.kind === kind && r.view === view && r.startMs >= fromMs && r.endMs <= toMs);
  if (inside.length < atLeast) throw new Error(`the injected load for ${what} ran ${inside.length} time(s) inside its window ${Math.round(fromMs)}-${Math.round(toMs)} ms, ${atLeast} needed`);
}
