import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

const appDir = process.argv[2] ?? "";
const out = process.argv[3] ?? "";
if (!appDir || !out || !process.env["WAYLAND_DISPLAY"]) {
  console.error("usage (inside a headless weston, see floating-check/weston.sh): bun desktop/scripts/floating-check.ts <test app folder> <out dir>");
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "kiwi-floating-check-"));
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

function shot(name: string): boolean {
  const before = new Set(readdirSync(out));
  try {
    execFileSync("weston-screenshooter", [], { cwd: out, timeout: 10_000, stdio: "ignore" });
  } catch {
    // weston writes the file even when the tool exits oddly: look for it below.
  }
  const made = readdirSync(out).find((f) => f.startsWith("wayland-screenshot-") && !before.has(f));
  if (!made) return false;
  renameSync(join(out, made), join(out, `${name}.png`));
  return true;
}

const width = 1280;
const height = 800;
const px = new Uint8Array(width * height * 3);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3;
    const warm = x < width / 2;
    px[i] = warm ? 240 : 40;
    px[i + 1] = warm ? 120 : 90;
    px[i + 2] = warm ? 30 : 230;
  }
const wall = join(root, "wall.ppm");
writeFileSync(wall, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), Buffer.from(px)]));

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`, { GSETTINGS_BACKEND: "keyfile" });
for (const key of ["picture-uri", "picture-uri-dark"]) execFileSync("gsettings", ["set", "org.gnome.desktop.background", key, `file://${wall}`], { env });
const app = launch(appExecutable(appDir), env);
let d: Driver | null = null;
try {
  d = await attach(join(root, "driver.sock"));
  const driver = d;
  await firstChannel(driver, 3);
  await until("the composer", 30_000, () => driver.evaluate(() => (document.querySelector('textarea[aria-label="Message"]') ? true : null), null, 2_000));
  const painted = () => driver.evaluate(() => new Promise<boolean>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, 30_000);

  await step("on a floating desktop the page knows windows float there", async () => {
    const wm = await driver.evaluate(() => document.documentElement.dataset["wm"] ?? null, null, 5_000);
    return { ok: wm === "floating", detail: { wm } };
  });

  await step("weston doesn't blur, so the page draws GNOME's wallpaper behind its shell", async () => {
    const got = await until("the wallpaper behind the shell", 20_000, () =>
      driver.evaluate(() => (document.documentElement.style.getPropertyValue("--backdrop") ? { frost: document.documentElement.dataset["frost"] ?? null } : null), null, 5_000),
    ).catch(() => null);
    return { ok: got?.frost === "image", detail: got };
  });

  await step("close, minimize and maximize show at the top left, with no GTK title bar (floating.png)", async () => {
    await driver.evaluate(() => void (document.documentElement.dataset["theme"] = "dark"), null, 5_000);
    await painted();
    await later(2_500);
    const buttons = await driver.evaluate(
      () =>
        ["Close window", "Minimize window", "Maximize window"].map((label) => {
          const r = document.querySelector(`button[aria-label="${label}"]`)?.getBoundingClientRect();
          return r && r.width > 0 ? { label, x: Math.round(r.x), y: Math.round(r.y) } : null;
        }),
      null,
      5_000,
    );
    const taken = shot("floating");
    return { ok: buttons.every((b) => b !== null && b.x < 120 && b.y < 60) && taken, detail: { buttons, screenshot: taken } };
  });

  await step("Maximize fills the screen (maximized.png)", async () => {
    const before = await driver.evaluate(() => ({ w: outerWidth, h: outerHeight }), null, 5_000);
    await driver.evaluate(() => void document.querySelector<HTMLButtonElement>('button[aria-label="Maximize window"]')?.click(), null, 5_000);
    const after = await until("a bigger window", 10_000, () =>
      driver.evaluate((b: { w: number; h: number }) => (outerWidth > b.w || outerHeight > b.h ? { w: outerWidth, h: outerHeight } : null), before, 5_000),
    ).catch(() => null);
    await painted();
    await later(1_500);
    const taken = shot("maximized");
    return { ok: after !== null && taken, detail: { before, after, screenshot: taken } };
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
