import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { TEST_ID } from "./eb-bundle.ts";
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

try {
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
