import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "linux" || !process.env.DISPLAY) {
  console.error(
    "usage (on Linux under Xvfb, with openbox and wmctrl installed): xvfb-run -a -s '-screen 0 1280x800x24' bun desktop/scripts/eb-window-controls.ts <Channels built with CHANNELS_EB_TEST=1>",
  );
  process.exit(2);
}

const sh = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

const wm = spawn("openbox", [], { stdio: "ignore", detached: true });
await until("openbox managing the screen", 15_000, async () => (sh(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"]).includes("window id") ? true : null));

const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-window-controls-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];

type Controls = { names: string[]; xs: number[]; regions: string[]; overlaps: string[] };

const controls = (d: Driver): Promise<Controls | null> =>
  d.evaluate(() => {
    const box = document.querySelector(".wm-controls");
    if (!box) return null;
    const buttons = [...box.querySelectorAll("button")];
    const rect = box.getBoundingClientRect();
    const hits = (r: DOMRect) => r.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
    const others = [...document.querySelectorAll(".top-tools > *, .rail .tile, .top-lead, .top-here")].filter((el) => !box.contains(el) && hits(el.getBoundingClientRect()));
    const region = (b: Element) => {
      const r = b.getBoundingClientRect();
      for (let el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); el; el = el.parentElement) {
        const v = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
        if (v === "drag" || v === "no-drag") return v;
      }
      return "-";
    };
    return {
      names: buttons.map((b) => b.getAttribute("aria-label") ?? ""),
      xs: buttons.map((b) => b.getBoundingClientRect().x),
      regions: buttons.map(region),
      overlaps: others.map(
        (el) =>
          `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
            .trim()
            .replace(/\s+/g, ".")}`,
      ),
    };
  }, null);

const press = (d: Driver, index: number): Promise<boolean> =>
  d.evaluate((i: number) => !!document.querySelectorAll(".wm-controls button")[i]?.dispatchEvent(new MouseEvent("click", { bubbles: true })), index);
const label = (d: Driver): Promise<string> => d.evaluate(() => document.querySelectorAll(".wm-controls button")[1]?.getAttribute("aria-label") ?? "", null);
const maximized = (win: string): boolean => /MAXIMIZED_VERT/.test(sh(["xprop", "-id", win, "_NET_WM_STATE"]));
const iconic = (win: string): boolean => /Iconic/.test(sh(["xprop", "-id", win, "WM_STATE"]));

const app = launch(exe, env);
try {
  const d = await attach(join(root, "driver.sock"));
  try {
    await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
    const win = await until("a visible Channels window", 30_000, async () => sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]).split("\n")[0] || null);
    console.log(`session: X11 under Xvfb (${process.env.DISPLAY}) with openbox; window ${win}`);
    await firstChannel(d, 0);
    const wmMark = await d.evaluate(() => document.documentElement.dataset["wm"] ?? "", null);
    if (wmMark !== "floating") throw new Error(`the window isn't marked floating under openbox (data-wm=${wmMark || "none"})`);

    for (const size of [
      { name: "wide (tabs)", width: 1280, height: 800 },
      { name: "medium", width: 1000, height: 760 },
      { name: "narrow", width: 700, height: 760 },
    ]) {
      spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${size.width},${size.height}`], { stdio: "ignore" });
      await until(`the ${size.name} size applied`, 10_000, async () => (await d.evaluate(() => innerWidth, null)) === size.width || null);
      await Bun.sleep(400);
      const c = await until(`the window controls in the ${size.name} layout`, 10_000, () => controls(d));
      console.log(`${size.name}: ${c.names.join(" | ")} at x ${c.xs.map(Math.round).join(", ")}; regions ${c.regions.join(", ")}`);
      if (c.names.join("|") !== "Minimize window|Maximize window|Close window") problems.push(`${size.name}: controls read ${JSON.stringify(c.names)}`);
      if (!(c.xs[0]! < c.xs[1]! && c.xs[1]! < c.xs[2]!)) problems.push(`${size.name}: controls aren't ordered left to right (${c.xs.join(", ")})`);
      if (c.regions.some((r) => r === "drag")) problems.push(`${size.name}: a control sits in a drag region (${c.regions.join(", ")})`);
      if (c.overlaps.length) problems.push(`${size.name}: the controls overlap ${c.overlaps.join(", ")}`);
      const right = await d.evaluate(() => innerWidth - (document.querySelector(".wm-controls")?.getBoundingClientRect().right ?? 0), null);
      if (right > 16) problems.push(`${size.name}: the controls aren't at the top-right (${right}px from the right edge)`);
    }

    await press(d, 1);
    await until("Maximize maximizes the window", 10_000, async () => (maximized(win) ? true : null));
    await until("the button reads Restore after Maximize", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
    await press(d, 1);
    await until("Restore restores the window", 10_000, async () => (!maximized(win) ? true : null));
    await until("the button reads Maximize after Restore", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));

    spawnSync("wmctrl", ["-i", "-r", win, "-b", "add,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager maximizes the window", 10_000, async () => (maximized(win) ? true : null));
    await until("the button reads Restore after the window manager maximized it", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
    spawnSync("wmctrl", ["-i", "-r", win, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager restores the window", 10_000, async () => (!maximized(win) ? true : null));
    await until("the button reads Maximize after the window manager restored it", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));

    await press(d, 0);
    await until("Minimize iconifies the window", 10_000, async () => (iconic(win) ? true : null));
    spawnSync("wmctrl", ["-i", "-a", win], { stdio: "ignore" });
    await until("the window comes back", 10_000, async () => (!iconic(win) ? true : null));

    await press(d, 2);
    await until("Close takes the window off the screen", 10_000, async () => (sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]) === "" ? true : null));
    console.log("pressed: Maximize, Restore, a window-manager maximize and restore, Minimize, then Close last");
  } finally {
    d.close();
  }
} finally {
  await stop(app);
  relay.kill();
  if (wm.pid) process.kill(-wm.pid);
  rmSync(root, { recursive: true, force: true });
}

if (problems.length) {
  for (const p of problems) console.error(`eb-window-controls: ${p}`);
  process.exit(1);
}
console.log("ok: Minimize, Maximize/Restore and Close sit at the top-right without overlap, act on the window, and the label follows the window manager");
