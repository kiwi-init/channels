import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";
import { glassParts, tints } from "./glass-shot.ts";
import { contrast, ppm } from "./shot-pixels.ts";

const appDir = process.argv[2] ?? "";
const out = process.argv[3] ?? "";
if (!appDir || !out || !process.env["WAYLAND_DISPLAY"] || !process.env["HYPRLAND_INSTANCE_SIGNATURE"]) {
  console.error("usage (inside a Hyprland session, see hyprland-check/arch.sh): bun desktop/scripts/hyprland-glass-check.ts <test app folder> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "kiwi-hyprland-glass-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

type Client = { class: string; at: [number, number]; size: [number, number] };
const windowOf = (appId: string): Client | null => (JSON.parse(execFileSync("hyprctl", ["clients", "-j"], { encoding: "utf8" })) as Client[]).find((c) => c.class === appId) ?? null;
const screen = () => ppm(execFileSync("grim", ["-t", "ppm", "-"], { maxBuffer: 256 * 1024 * 1024 }));

const width = 1440;
const height = 900;
const px = new Uint8Array(width * height * 3);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const warm = x < width / 2;
    const dim = Math.floor(x / 3) % 2 ? 0.6 : 1;
    px.set([(warm ? 240 : 40) * dim, (warm ? 120 : 90) * dim, (warm ? 30 : 230) * dim], (y * width + x) * 3);
  }
const wall = join(root, "wall.ppm");
writeFileSync(wall, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(px)]));
const paper = spawn("swaybg", ["-i", wall, "-m", "fill"], { stdio: "ignore" });

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const app = launch(appExecutable(appDir), testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`));
let d: Driver | null = null;
try {
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 3);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector(".main .composer textarea") ? true : null), null, 2_000));
  const painted = () => driver.evaluate(() => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, 30_000);

  await step("the wallpaper on the screen is striped, so a blur behind the window can be told from a clear view", async () => {
    await later(2_000);
    const stripes = contrast(screen(), { x: 0, y: height - 40, width, height: 20 });
    return { ok: (stripes ?? 0) > 20, detail: { contrastAtTheBottomEdge: stripes } };
  });

  await step("on Hyprland the page is marked for the compositor's blur", async () => {
    const parts = await until('data-glass="blur"', 20_000, async () => {
      const p = await driver.evaluate(glassParts, null, 5_000);
      return p.glass === "blur" && p.top ? p : null;
    }).catch(() => driver.evaluate(glassParts, null, 5_000));
    return { ok: parts.glass === "blur", detail: parts };
  });

  await step("the frame shows the desktop through the window, warm on the left and cool on the right, blurred by Hyprland, and the page stays solid (glass-hyprland.png)", async () => {
    const parts = await driver.evaluate(glassParts, null, 5_000);
    const win = await until("the window in Hyprland's list", 20_000, async () => windowOf("channels-desktop"));
    await painted();
    await later(2_000);
    execFileSync("grim", [join(out, "glass-hyprland.png")]);
    const picture = screen();
    const at = { x: win.at[0], y: win.at[1] };
    const t = tints(picture, at, parts);
    const side = parts.side;
    const stripes = side ? contrast(picture, { x: at.x + side.x + 8, y: at.y + side.y + side.height * 0.6, width: side.width - 16, height: side.height * 0.3 }) : null;
    const through = (t.left ?? 0) > 15 && (t.right ?? 0) < -15 && (t.side === null || t.side > 15);
    return { ok: through && (t.page ?? 99) < 12 && stripes !== null && stripes < 12, detail: { tints: t, stripesLeftInTheSidebar: stripes, window: win, parts } };
  });
} catch (e) {
  record("the check set up", false, e instanceof Error ? e.message : String(e));
} finally {
  writeFileSync(join(out, "results.json"), JSON.stringify(checks, null, 2));
  d?.close();
  await stop(app).catch(() => undefined);
  paper.kill();
  relay.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${failed.length} of ${checks.length} checks failed; screenshots in ${out}`);
process.exit(failed.length ? 1 : 0);
