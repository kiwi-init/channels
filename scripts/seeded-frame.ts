import type { BrowserContext, Page } from "playwright-core";

export interface FrameProbeArgs {
  seq: number;
  text: string;
  budgetMs: number;
}

export interface SeededFrame {
  firstFrameMs: number;
  confirmedMs: number;
  frames: number;
  resets: number;
  timeOrigin: number;
  clockSkewMs: number;
}

const KEY = "__kiwiSeededFrame";

export function seededFrameProbe({ seq, text, budgetMs }: FrameProbeArgs): void {
  const key = "__kiwiSeededFrame";
  const shown = (): boolean => {
    const row = document.querySelector(`[data-seq="${seq}"]`);
    if (!row || !(row.textContent ?? "").includes(text)) return false;
    if (row.closest("[data-unfinished]")) return false;
    if (!row.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    const r = row.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  let first: number | null = null;
  let frames = 0;
  let resets = 0;
  const tick = (at: number): void => {
    frames++;
    if (at > budgetMs) {
      Reflect.set(window, key, { failed: `the seeded row #${seq} wasn't visible two frames running within ${budgetMs} ms of the navigation` });
      return;
    }
    if (shown()) {
      if (first !== null) {
        Reflect.set(window, key, { firstFrameMs: first, confirmedMs: at, frames, resets, timeOrigin: performance.timeOrigin, clockSkewMs: Date.now() - (performance.timeOrigin + performance.now()) });
        return;
      }
      first = at;
    } else if (first !== null) {
      resets++;
      first = null;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export async function watchSeededFrame(context: BrowserContext, args: FrameProbeArgs): Promise<void> {
  await context.addInitScript(seededFrameProbe, args);
}

const num = (o: object, k: string): number | null => {
  const v: unknown = Reflect.get(o, k);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export async function readSeededFrame(page: Page, timeoutMs: number): Promise<SeededFrame> {
  await page
    .waitForFunction((key) => Reflect.get(window, key) !== undefined, KEY, { timeout: timeoutMs })
    .catch(() => {
      throw new Error(`the reload probe left no mark within ${timeoutMs} ms of the row showing to Playwright`);
    });
  const raw: unknown = await page.evaluate((key) => Reflect.get(window, key), KEY);
  if (!raw || typeof raw !== "object") throw new Error("the reload probe's mark isn't an object");
  const failed: unknown = Reflect.get(raw, "failed");
  if (typeof failed === "string") throw new Error(`the reload probe failed: ${failed}`);
  const firstFrameMs = num(raw, "firstFrameMs");
  const confirmedMs = num(raw, "confirmedMs");
  const frames = num(raw, "frames");
  const resets = num(raw, "resets");
  const timeOrigin = num(raw, "timeOrigin");
  const clockSkewMs = num(raw, "clockSkewMs");
  if (firstFrameMs === null || confirmedMs === null || frames === null || resets === null || timeOrigin === null || clockSkewMs === null)
    throw new Error(`the reload probe's mark is incomplete: ${JSON.stringify(raw)}`);
  return { firstFrameMs, confirmedMs, frames, resets, timeOrigin, clockSkewMs };
}

export function reloadFromHost(epochBefore: number, frame: SeededFrame): { reloadMs: number; navigationOffsetMs: number } {
  const navigationOffsetMs = frame.timeOrigin - epochBefore;
  if (navigationOffsetMs < -2) throw new Error(`the page's navigation started ${-navigationOffsetMs} ms before the host's reload call: the clocks don't line up`);
  return { reloadMs: Math.round(navigationOffsetMs + frame.firstFrameMs), navigationOffsetMs: Math.round(navigationOffsetMs * 10) / 10 };
}
