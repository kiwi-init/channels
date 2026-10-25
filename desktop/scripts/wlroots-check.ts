import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

const appDir = process.argv[2] ?? "";
const out = process.argv[3] ?? "";
if (!appDir || !out || !process.env["WAYLAND_DISPLAY"] || !process.env["SWAYSOCK"] || process.env["DISPLAY"]) {
  console.error("usage (inside a Wayland-only headless sway, see wlroots-check/sway.sh): bun desktop/scripts/wlroots-check.ts <test app folder> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "kiwi-wlroots-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Rect = { x: number; y: number; width: number; height: number };
type Node = { type: string; name: string | null; app_id?: string | null; shell?: string; rect: Rect; window_rect: Rect; geometry: Rect; nodes: Node[]; floating_nodes: Node[] };
type Page = { w: number; h: number; dpr: number };
type Pixels = { width: number; height: number; colors: number; hash: string };

const checks: { check: string; ok: boolean; detail: unknown }[] = [];
const record = (check: string, ok: boolean, detail: unknown) => {
  checks.push({ check, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${check}: ${JSON.stringify(detail)}`);
};
const step = async (check: string, fn: () => Promise<{ ok: boolean; detail: unknown }>) => {
  try {
    const r = await fn();
    record(check, r.ok, r.detail);
  } catch (e) {
    record(check, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
};

const sway = (...args: string[]): string => execFileSync("swaymsg", args, { encoding: "utf8" });
const tree = (): Node => JSON.parse(sway("-t", "get_tree", "-r")) as Node;
const find = (n: Node, is: (n: Node) => boolean): Node | null => {
  if (is(n)) return n;
  for (const c of [...n.nodes, ...n.floating_nodes]) {
    const f = find(c, is);
    if (f) return f;
  }
  return null;
};
const windowOf = (appId: string): Node | null => find(tree(), (n) => n.app_id === appId);
const titled = (title: string): Node | null => find(tree(), (n) => n.name === title && n.app_id !== undefined);
const exitWithin = (p: ChildProcess, ms: number): Promise<number | null> =>
  new Promise((r) => {
    if (p.exitCode !== null) return r(p.exitCode);
    const timer = setTimeout(() => r(null), ms);
    p.once("exit", (code) => (clearTimeout(timer), r(code)));
  });
const output = (width: number, height: number, scale: number) => void sway("output", "HEADLESS-1", "resolution", `${width}x${height}`, "scale", String(scale));
const near = (a: number, b: number, by: number) => Math.abs(a - b) <= by;

function pixels(r: Rect): Pixels {
  const ppm = execFileSync("grim", ["-t", "ppm", "-g", `${r.x},${r.y} ${r.width}x${r.height}`, "-"], { maxBuffer: 256 * 1024 * 1024 });
  const head = ppm.subarray(0, 64).toString("latin1").split(/\s+/);
  const width = Number(head[1]);
  const height = Number(head[2]);
  const body = ppm.subarray(ppm.length - width * height * 3);
  const colors = new Set<number>();
  for (let i = 0; i < body.length; i += 3 * 7) colors.add(((body[i]! >> 4) << 8) | ((body[i + 1]! >> 4) << 4) | (body[i + 2]! >> 4));
  return { width, height, colors: colors.size, hash: Bun.hash(body).toString(16) };
}

async function shot(name: string, r: Rect, painted: () => Promise<unknown>): Promise<Pixels & { steadyAfterMs: number }> {
  const started = Date.now();
  await painted();
  let last = pixels(r);
  for (;;) {
    await later(2_000);
    const now = pixels(r);
    if ((now.hash === last.hash && drawn(now)) || Date.now() - started > 45_000) {
      execFileSync("grim", ["-g", `${r.x},${r.y} ${r.width}x${r.height}`, join(out, `${name}.png`)]);
      return { ...now, steadyAfterMs: Date.now() - started };
    }
    last = now;
  }
}

const drawn = (p: Pixels) => p.colors >= 16;

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const app = launch(appExecutable(appDir), env);
const helpers: ChildProcess[] = [];
let d: Driver | null = null;
try {
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 3);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector('textarea[aria-label="Message"]') ? true : null), null, 2_000));
  const page = () => driver.evaluate((): Page => ({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio }), null, 5_000);
  const settled = async (what: string, fits: (n: Node, p: Page) => boolean): Promise<{ n: Node; p: Page }> => {
    const got = await until(what, 15_000, async () => {
      const n = windowOf("channels-livewire");
      const p = await page();
      return n && fits(n, p) ? { n, p } : null;
    }).catch(async () => ({ n: windowOf("channels-livewire"), p: await page() }));
    if (!got.n) throw new Error(`${what}: no channels-livewire window in sway's tree`);
    return { n: got.n, p: got.p };
  };
  const painted = () => driver.evaluate(() => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, 30_000);
  const follows = (n: Node, p: Page) => near(p.w, n.window_rect.width, 2) && p.h <= n.window_rect.height && p.h > n.window_rect.height - 80;

  await step("the window is a native Wayland toplevel (xdg_shell) whose app_id is channels-livewire", async () => {
    const n = await until("the window in sway's tree", 30_000, async () => windowOf("channels-livewire"));
    return { ok: n.shell === "xdg_shell", detail: { app_id: n.app_id, shell: n.shell, title: n.name } };
  });

  await step("tiled alone on a 1440x900 screen, the page fills the tile and is drawn (tiled.png)", async () => {
    output(1440, 900, 1);
    const { n, p } = await settled("the page at the tile's size", follows);
    const px = await shot("tiled", n.rect, painted);
    return { ok: follows(n, p) && drawn(px), detail: { tile: n.window_rect, page: p, pixels: px } };
  });

  await step("floating at 1000x700, the page follows the window and is drawn (floating.png)", async () => {
    sway("[app_id=channels-livewire]", "floating", "enable");
    await settled("the page at the floating window's own size", follows);
    await until("the floating window at 1000x700", 20_000, async () => {
      sway("[app_id=channels-livewire]", "resize", "set", "width", "1000", "px", "height", "700", "px");
      await later(1_500);
      return near(windowOf("channels-livewire")?.rect.width ?? 0, 1000, 1) ? true : null;
    });
    sway("[app_id=channels-livewire]", "move", "position", "center");
    const { n, p } = await settled("the page at the floating size", (w, q) => near(w.window_rect.width, 1000, 4) && follows(w, q));
    const px = await shot("floating", n.rect, painted);
    sway("[app_id=channels-livewire]", "floating", "disable");
    return { ok: near(n.window_rect.width, 1000, 4) && follows(n, p) && drawn(px), detail: { window: n.window_rect, page: p, pixels: px } };
  });

  await step("tiled beside another window on a 1440x900 screen, the page fills its half tile and is drawn (half.png)", async () => {
    helpers.push(spawn("python3", [join(import.meta.dir, "wayland-check", "helper.py"), join(root, "read.json"), join(root, "kiwi-drop.png")], { env: { ...process.env, GDK_BACKEND: "wayland" } }));
    const other = await until("the second window, tiled", 20_000, async () => titled("kiwi-helper"));
    const { n, p } = await settled("the page at the half tile's size", (w, q) => w.window_rect.width < 800 && follows(w, q));
    const px = await shot("half", n.rect, painted);
    return { ok: n.window_rect.width < 800 && follows(n, p) && drawn(px), detail: { tile: n.window_rect, other: other.rect, page: p, pixels: px } };
  });

  await step("tiled beside another window on a 1366x768 laptop screen (a tile under the 720x480 minimum), the page fills its tile and is drawn (half-small.png)", async () => {
    output(1366, 768, 1);
    const { n, p } = await settled("the page at the small half tile's size", (w, q) => w.window_rect.width < 700 && follows(w, q));
    const px = await shot("half-small", n.rect, painted);
    return { ok: follows(n, p) && drawn(px), detail: { tile: n.window_rect, page: p, pixels: px } };
  });
  for (const h of helpers.splice(0)) h.kill();

  await step("at output scale 2 (a HiDPI laptop), the page draws at devicePixelRatio 2 (scale2.png)", async () => {
    await until("the second window gone", 10_000, async () => (titled("kiwi-helper") ? null : true));
    output(2880, 1800, 2);
    const { n, p } = await settled("the page at scale 2", (w, q) => q.dpr === 2 && follows(w, q));
    const px = await shot("scale2", n.rect, painted);
    return { ok: p.dpr === 2 && px.width === n.rect.width * 2 && drawn(px), detail: { window: n.window_rect, page: p, pixels: px } };
  });

  await step("closed from the compositor (Super+W) with no tray host, the window leaves the screen", async () => {
    const before = await driver.main("window");
    sway("[app_id=channels-livewire]", "kill");
    const gone = await until("the window off the screen", 10_000, async () => (windowOf("channels-livewire") ? null : true)).catch(() => false);
    const after = await driver.main("window").catch((e: unknown) => `threw: ${String(e)}`);
    return { ok: gone === true, detail: { before, after, stillOnScreen: windowOf("channels-livewire") !== null, running: app.exitCode === null } };
  });

  await step("launched again from the app launcher, the window is on the screen (reopened.png)", async () => {
    const again = launch(appExecutable(appDir), env);
    const back = await until("the window on the screen", 30_000, async () => windowOf("channels-livewire")).catch(() => null);
    const second = await exitWithin(again, 15_000);
    const px = back ? await shot("reopened", back.rect, painted) : null;
    return { ok: back !== null && px !== null && drawn(px), detail: { window: back?.window_rect ?? null, secondLaunchExit: second, firstStillRunning: app.exitCode === null } };
  });
} catch (e) {
  record("the check set up", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(checks, null, 2));
  for (const h of helpers) h.kill();
  d?.close();
  await stop(app).catch(() => undefined);
  relay.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length} of ${checks.length} checks failed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
