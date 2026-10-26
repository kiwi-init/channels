import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

const appDir = process.argv[2] ?? "";
const out = process.argv[3] ?? "";
if (!appDir || !out || !process.env["WAYLAND_DISPLAY"] || !process.env["HYPRLAND_INSTANCE_SIGNATURE"]) {
  console.error("usage (inside a headless Hyprland, see hyprland-check/hyprland.sh): bun desktop/scripts/hyprland-check.ts <test app folder> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "kiwi-hyprland-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Client = { class: string; at: [number, number]; size: [number, number]; xwayland: boolean };
type Rgb = [number, number, number];

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

const clients = (): Client[] => JSON.parse(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8" })) as Client[];
const windowOf = (cls: string): Client | null => clients().find((c) => c.class === cls) ?? null;

function screen(): { width: number; height: number; at: (x: number, y: number) => Rgb } {
  const ppm = execFileSync("grim", ["-t", "ppm", "-"], { maxBuffer: 256 * 1024 * 1024 });
  const head = ppm.subarray(0, 64).toString("latin1").split(/\s+/);
  const width = Number(head[1]);
  const height = Number(head[2]);
  const body = ppm.subarray(ppm.length - width * height * 3);
  return { width, height, at: (x, y) => [body[(y * width + x) * 3] ?? 0, body[(y * width + x) * 3 + 1] ?? 0, body[(y * width + x) * 3 + 2] ?? 0] };
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const app = launch(appExecutable(appDir), env);
let d: Driver | null = null;
try {
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 3);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector('textarea[aria-label="Message"]') ? true : null), null, 2_000));
  const painted = () => driver.evaluate(() => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, 30_000);

  await step("the window is a native Wayland client of Hyprland, not XWayland", async () => {
    const c = await until("the window in Hyprland's clients", 30_000, async () => windowOf("channels-desktop"));
    return { ok: !c.xwayland, detail: { class: c.class, at: c.at, size: c.size } };
  });

  await step("the page knows Hyprland blurs behind it, and frosts its shell", async () => {
    const frost = await driver.evaluate(() => document.documentElement.dataset["frost"] ?? null, null, 5_000);
    return { ok: frost === "tint", detail: { frost } };
  });

  await step("Settings offers tints from the wallpaper swaybg shows", async () => {
    const tints = await driver.evaluate(
      () => (window as unknown as { kiwi?: { wallpaperTints?: (dark: boolean) => Promise<string[]> } }).kiwi?.wallpaperTints?.(true) ?? Promise.resolve(null),
      null,
      10_000,
    );
    return { ok: Array.isArray(tints) && tints.length > 0, detail: { tints } };
  });

  await step("the sidebar shows the wallpaper's colours through the frost, while the page stays near black (frost.png)", async () => {
    await driver.evaluate(() => void (document.documentElement.dataset["theme"] = "dark"), null, 5_000);
    execFileSync("hyprctl", ["dispatch", "fullscreen", "1"]);
    await later(1_500);
    await painted();
    await later(2_000);
    const c = windowOf("channels-desktop");
    if (!c) throw new Error("no channels-desktop window");
    execFileSync("grim", [join(out, "frost.png")]);
    const s = screen();
    const sidebar = s.at(c.at[0] + 140, c.at[1] + Math.round(c.size[1] * 0.75));
    const page = s.at(c.at[0] + Math.round(c.size[0] * 0.6), c.at[1] + Math.round(c.size[1] * 0.5));
    const warm = sidebar[0] - sidebar[2];
    return { ok: warm > 12 && Math.max(...page) < 40, detail: { sidebar, page, window: { at: c.at, size: c.size } } };
  });
} catch (e) {
  record("the check set up", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(checks, null, 2));
  d?.close();
  await stop(app).catch(() => undefined);
  relay.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length} of ${checks.length} checks failed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
