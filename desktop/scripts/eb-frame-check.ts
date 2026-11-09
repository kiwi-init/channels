import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { TEST_ID } from "./bundle-ids.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage (on a Mac): bun desktop/scripts/eb-frame-check.ts <Channels.app built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}
type Frame = { x: number; y: number; width: number; height: number };
const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-frame-check-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];
spawnSync("defaults", ["delete", TEST_ID, "NSWindow Frame Channels"], { stdio: "ignore" });
const same = (a: Frame, b: Frame): boolean => (["x", "y", "width", "height"] as const).every((k) => Math.abs(a[k] - b[k]) <= 1);

async function run<T>(what: (d: Driver) => Promise<T>): Promise<T> {
  const app = launch(exe, env);
  try {
    const d = await attach(join(root, "driver.sock"));
    try {
      await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
      return await what(d);
    } finally {
      d.close();
    }
  } finally {
    await stop(app);
  }
}

const doubleClickTop = (): string | null => {
  const drags = (el: Element): boolean => {
    for (let at: Element | null = el; at; at = at.parentElement) {
      const region = getComputedStyle(at).getPropertyValue("--electrobun-app-region").trim() || getComputedStyle(at).getPropertyValue("-webkit-app-region").trim();
      if (region === "no-drag") return false;
      if (region === "drag") return true;
    }
    return false;
  };
  for (let y = 8; y <= 48; y += 8)
    for (let x = 16; x < innerWidth; x += 24) {
      const el = document.elementFromPoint(x, y);
      if (!el || !drags(el)) continue;
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, detail: 2, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, detail: 2, clientX: x, clientY: y }));
      return `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} at ${x},${y}`;
    }
  return null;
};
const zoomed = async (d: Driver): Promise<boolean> => ((await d.main("window")) as { maximized?: unknown }).maximized === true;

try {
  await run(async (d) => {
    if (await zoomed(d)) return void problems.push("a first start opens zoomed, so a double click can't show it zooms");
    const hit = await d.evaluate(doubleClickTop, null);
    if (!hit) return void problems.push("no drag region in the top 48px of the window to double-click");
    console.log(`double-clicked ${hit}`);
    await until("the window zoomed by a double click on its top bar", 10_000, async () => (await zoomed(d)) || null).catch(() =>
      problems.push("a double click on the top bar doesn't zoom the window"),
    );
    console.log(`zoomed: ${JSON.stringify(await d.main("frame"))}`);
    await d.evaluate(doubleClickTop, null);
    await until("the window back from zoom by a second double click", 10_000, async () => !(await zoomed(d)) || null).catch(() =>
      problems.push("a second double click on the top bar doesn't bring the window back"),
    );
  });
  spawnSync("defaults", ["delete", TEST_ID, "NSWindow Frame Channels"], { stdio: "ignore" });
  const first = await run(async (d) => (await d.main("frame")) as Frame);
  console.log(`first start: ${JSON.stringify(first)}`);
  if (first.width > 1200 || first.height > 800 || first.width < 768) problems.push(`a first start opens at ${first.width}x${first.height}, not 1200x800 or the screen's size`);
  const placed = await run(async (d) => (await d.main("placeForTest")) as Frame);
  console.log(`moved and resized to: ${JSON.stringify(placed)}, then quit`);
  const back = await run(async (d) => (await d.main("frame")) as Frame);
  console.log(`after a restart: ${JSON.stringify(back)}`);
  if (!same(placed, back)) problems.push(`after a restart the window is at ${JSON.stringify(back)}, not where it was left (${JSON.stringify(placed)})`);
  if (same(first, back)) problems.push("after a restart the window is back where a first start puts it");
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: the window opens where it was left, at the size it was left");
