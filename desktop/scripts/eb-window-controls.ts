import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "linux" || !process.env.DISPLAY) {
  console.error(
    "usage (on Linux under Xvfb, with openbox, wmctrl and xdotool installed): xvfb-run -a -s '-screen 0 1280x800x24' bun desktop/scripts/eb-window-controls.ts <Channels built with CHANNELS_EB_TEST=1>",
  );
  process.exit(2);
}

const sh = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};
const xdo = (...args: string[]): void => {
  const r = spawnSync("xdotool", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`harness: xdotool ${args.join(" ")} exited ${r.status}: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
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

type Hit = { at: { x: number; y: number }; chain: string; decides: string; inside: boolean; layout: string };

const hitAt = (d: Driver, index: number): Promise<Hit | null> =>
  d.evaluate((i: number) => {
    const b = document.querySelectorAll(".wm-controls button")[i];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    if (r.width <= 0) return null;
    const at = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    const name = (el: Element) =>
      `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
        .trim()
        .replace(/\s+/g, ".")}`;
    const top = document.elementFromPoint(at.x, at.y);
    const chain: string[] = [];
    let decides = "-";
    for (let el = top; el; el = el.parentElement) {
      const region = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
      chain.push(`${name(el)}[${region || "-"}]`);
      if (decides === "-" && (region === "drag" || region === "no-drag")) decides = region;
    }
    const layout = `${document.documentElement.hasAttribute("data-tabs") ? "tabs" : "sidebar"} ${innerWidth}x${innerHeight}`;
    return { at, chain: chain.slice(0, 7).join(" < "), decides, inside: !!top && b.contains(top), layout };
  }, index);

const timeline = async (d: Driver, from: number, until: number, seen: string[]): Promise<void> => {
  let last = seen.at(-1)?.replace(/^\+\d+ms /, "") ?? "";
  while (Date.now() < until) {
    const now = await d.evaluate(() => {
      const regions = [...document.querySelectorAll(".wm-controls button")].map((b) => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        for (let el = top; el; el = el.parentElement) {
          const v = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
          if (v === "drag" || v === "no-drag") return `${v}${top && b.contains(top) ? "" : "(covered)"}`;
        }
        return top && b.contains(top) ? "-" : "-(covered)";
      });
      return `${document.documentElement.hasAttribute("data-tabs") ? "tabs" : "sidebar"} ${innerWidth}px ${regions.join(",")}`;
    }, null);
    if (now !== last) seen.push(`+${Date.now() - from}ms ${now}`);
    last = now;
    await Bun.sleep(40);
  }
};

const click = (win: string, at: { x: number; y: number }): void => {
  xdo("mousemove", "--window", win, String(at.x), String(at.y));
  xdo("click", "1");
};
const NAMES = ["Minimize", "Maximize", "Close"];
const realClick = async (d: Driver, win: string, where: string, index: number, what: string, done: () => boolean): Promise<boolean> => {
  const hit = await hitAt(d, index);
  if (!hit) {
    problems.push(`${where}: no ${NAMES[index]} button on screen to click`);
    return false;
  }
  const sent = Date.now();
  click(win, hit.at);
  const acted = await until(what, 5_000, async () => (done() ? true : null)).catch(() => false);
  console.log(`${where}: a real click on ${NAMES[index]} at ${hit.at.x},${hit.at.y} (${hit.layout}): ${acted ? `acted in ${Date.now() - sent}ms` : "nothing happened in 5s"}; under it: ${hit.chain}`);
  if (!acted) problems.push(`${where}: a real click on ${NAMES[index]} didn't act on the window; under it: ${hit.chain}; the control ${hit.inside ? "was" : "wasn't"} the element hit`);
  return acted;
};
const sizeBack = async (d: Driver, win: string, width: number, height: number): Promise<void> => {
  if ((await d.evaluate(() => innerWidth, null)) === width) return;
  spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${width},${height}`], { stdio: "ignore" });
  await until(`the window back at ${width}px`, 10_000, async () => (await d.evaluate(() => innerWidth, null)) === width || null);
};
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
      const resized = Date.now();
      const seen: string[] = [];
      spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${size.width},${size.height}`], { stdio: "ignore" });
      await until(`the ${size.name} size applied`, 10_000, async () => (await d.evaluate(() => innerWidth, null)) === size.width || null);
      await timeline(d, resized, Date.now() + 400, seen);
      const c = await until(`the window controls in the ${size.name} layout`, 10_000, () => controls(d));
      const read = Date.now() - resized;
      await timeline(d, resized, resized + 2_500, seen);
      console.log(`${size.name}: after the resize (regions read at +${read}ms): ${seen.join("; ")}`);
      console.log(`${size.name}: ${c.names.join(" | ")} at x ${c.xs.map(Math.round).join(", ")}; regions ${c.regions.join(", ")}`);
      if (c.names.join("|") !== "Minimize window|Maximize window|Close window") problems.push(`${size.name}: controls read ${JSON.stringify(c.names)}`);
      if (!(c.xs[0]! < c.xs[1]! && c.xs[1]! < c.xs[2]!)) problems.push(`${size.name}: controls aren't ordered left to right (${c.xs.join(", ")})`);
      if (c.regions.some((r) => r === "drag")) problems.push(`${size.name}: a control sits in a drag region (${c.regions.join(", ")})`);
      if (c.overlaps.length) problems.push(`${size.name}: the controls overlap ${c.overlaps.join(", ")}`);
      const arrows = await d.evaluate(() => {
        const box = document.querySelector(".top-history");
        if (!box) return null;
        const r = box.getBoundingClientRect();
        const hit = (o: DOMRect) => o.width > 0 && o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top;
        const name = (el: Element) =>
          `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
            .trim()
            .replace(/\s+/g, ".")}`;
        const regions = [...box.querySelectorAll("button")].map((b) => {
          const c = b.getBoundingClientRect();
          for (let el = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2); el; el = el.parentElement) {
            const v = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
            if (v === "drag" || v === "no-drag") return v;
          }
          return "-";
        });
        const overlaps = [...document.querySelectorAll(".wm-controls, .top-tools > *, .rail .tile, .top-here")].filter((el) => !box.contains(el) && hit(el.getBoundingClientRect())).map(name);
        return { regions, overlaps };
      }, null);
      console.log(`${size.name}: Back and Forward ${arrows ? `regions ${arrows.regions.join(", ")}` : "missing"}`);
      if (!arrows) problems.push(`${size.name}: no Back and Forward arrows in the top bar`);
      else if (arrows.regions.includes("drag")) problems.push(`${size.name}: a history arrow sits in a drag region (${arrows.regions.join(", ")})`);
      else if (arrows.overlaps.length) problems.push(`${size.name}: the history arrows overlap ${arrows.overlaps.join(", ")}`);
      const right = await d.evaluate(() => innerWidth - (document.querySelector(".wm-controls")?.getBoundingClientRect().right ?? 0), null);
      if (right > 16) problems.push(`${size.name}: the controls aren't at the top-right (${right}px from the right edge)`);

      if (await realClick(d, win, size.name, 1, "Maximize maximizes the window", () => maximized(win))) {
        await until("the button reads Restore after Maximize", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
        await realClick(d, win, `${size.name}, maximized`, 1, "Restore restores the window", () => !maximized(win));
        await until("the button reads Maximize after Restore", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));
      }
      if (maximized(win)) spawnSync("wmctrl", ["-i", "-r", win, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
      await sizeBack(d, win, size.width, size.height);
      if (await realClick(d, win, size.name, 0, "Minimize iconifies the window", () => iconic(win))) {
        spawnSync("wmctrl", ["-i", "-a", win], { stdio: "ignore" });
        await until("the window comes back", 10_000, async () => (!iconic(win) ? true : null));
      }
      await sizeBack(d, win, size.width, size.height);
    }

    spawnSync("wmctrl", ["-i", "-r", win, "-b", "add,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager maximizes the window", 10_000, async () => (maximized(win) ? true : null));
    await until("the button reads Restore after the window manager maximized it", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
    spawnSync("wmctrl", ["-i", "-r", win, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager restores the window", 10_000, async () => (!maximized(win) ? true : null));
    await until("the button reads Maximize after the window manager restored it", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));

    await sizeBack(d, win, 700, 760);
    await realClick(d, win, "narrow, last", 2, "Close takes the window off the screen", () => sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]) === "");
    console.log("clicked for real at every width: Maximize, Restore and Minimize; then a window-manager maximize and restore; then Close last");
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
