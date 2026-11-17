import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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

type Size = { name: string; width: number; height: number; layout: "tabs" | "sidebar" };
const FRAMES_MS = 4_000;
const layoutOf = (size: Size): string => `${size.layout} ${size.width}x${size.height}`;

const startFrames = (d: Driver): Promise<boolean> =>
  d.evaluate((ms: number) => {
    const frames: string[] = [];
    Reflect.set(window, "ebFrames", frames);
    Reflect.set(window, "ebFramesDone", false);
    const name = (el: Element | null) =>
      el
        ? `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
            .trim()
            .replace(/\s+/g, ".")}`
        : "nothing";
    const state = (b: Element | undefined): string => {
      if (!b) return "missing";
      const r = b.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return "missing";
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const covered = top && b.contains(top) ? "" : `(under ${name(top)}${top?.parentElement ? ` in ${name(top.parentElement)}` : ""})`;
      for (let el = top; el; el = el.parentElement) {
        const v = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
        if (v === "drag" || v === "no-drag") return `${v}${covered}`;
      }
      return `-${covered}`;
    };
    let first = -1;
    const tick = (now: number) => {
      if (first < 0) first = now;
      const buttons = [...document.querySelectorAll(".wm-controls button")];
      frames.push(
        `${Math.round(now - first)}\t${document.documentElement.hasAttribute("data-tabs") ? "tabs" : "sidebar"} ${innerWidth}x${innerHeight} ${[0, 1, 2].map((i) => state(buttons[i])).join(",")}`,
      );
      if (now - first < ms) requestAnimationFrame(tick);
      else Reflect.set(window, "ebFramesDone", true);
    };
    requestAnimationFrame(tick);
    return true;
  }, FRAMES_MS);

const framesDone = (d: Driver): Promise<string[] | null> =>
  d.evaluate(() => {
    const frames: unknown = Reflect.get(window, "ebFrames");
    return Reflect.get(window, "ebFramesDone") === true && Array.isArray(frames) ? frames.filter((f): f is string => typeof f === "string") : null;
  }, null);

const runs = (frames: string[]): string[] => {
  const out: { at: string; state: string; n: number }[] = [];
  for (const f of frames) {
    const [at = "", state = ""] = f.split("\t");
    const last = out.at(-1);
    if (last && last.state === state) last.n++;
    else out.push({ at, state, n: 1 });
  }
  return out.map((r) => `+${r.at}ms ${r.state} ×${r.n}`);
};

const click = (win: string, at: { x: number; y: number }): void => {
  xdo("mousemove", "--window", win, String(at.x), String(at.y));
  xdo("click", "1");
};
const ROOT_SHOT = [
  "import sys, gi",
  'gi.require_version("Gdk", "3.0")',
  "from gi.repository import Gdk",
  "root = Gdk.get_default_root_window()",
  'Gdk.pixbuf_get_from_window(root, 0, 0, root.get_width(), root.get_height()).savev(sys.argv[1], "png", [], [])',
].join("\n");
const shot = (name: string): void => {
  const dir = process.env.EB_WC_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const r = spawnSync("python3", ["-c", ROOT_SHOT, join(dir, `${name}.png`)], { encoding: "utf8" });
  console.log(r.status === 0 ? `screenshot: ${name}.png` : `no screenshot (${name}): ${(r.stderr || r.error?.message || "").trim().split("\n").pop() ?? ""}`);
};
const pageHearsClick = async (d: Driver, win: string): Promise<boolean> => {
  const middle = await d.evaluate(() => {
    const root = document.documentElement;
    root.dataset["heard"] = "";
    addEventListener("click", () => (root.dataset["heard"] = "click"), { capture: true, once: true });
    return { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
  }, null);
  click(win, middle);
  return until("a real click mid-page reaching the page", 5_000, async () => ((await d.evaluate(() => document.documentElement.dataset["heard"] === "click", null)) ? true : null)).catch(() => false);
};
const NAMES = ["Minimize", "Maximize", "Close"];
const clickActs = async (d: Driver, win: string, where: string, index: number, expect: string, what: string, done: () => boolean): Promise<{ acted: boolean; hit: Hit } | null> => {
  const hit = await hitAt(d, index);
  if (!hit) return null;
  if (hit.layout !== expect) throw new Error(`${where}: the window is ${hit.layout} right before the click on ${NAMES[index]}, not ${expect}, so this case can't be judged`);
  const sent = Date.now();
  click(win, hit.at);
  const acted = await until(what, 5_000, async () => (done() ? true : null)).catch(() => false);
  console.log(`${where}: a real click on ${NAMES[index]} at ${hit.at.x},${hit.at.y} (${hit.layout}): ${acted ? `acted in ${Date.now() - sent}ms` : "nothing happened in 5s"}; under it: ${hit.chain}`);
  return { acted, hit };
};
const realClick = async (d: Driver, win: string, where: string, index: number, expect: string, what: string, done: () => boolean): Promise<boolean> => {
  const r = await clickActs(d, win, where, index, expect, what, done);
  if (!r) problems.push(`${where}: no ${NAMES[index]} button on screen to click`);
  else if (!r.acted) problems.push(`${where}: a real click on ${NAMES[index]} didn't act on the window; under it: ${r.hit.chain}; the control ${r.hit.inside ? "was" : "wasn't"} the element hit`);
  return !!r?.acted;
};
const plantDrag = (d: Driver, on: boolean): Promise<boolean> =>
  d.evaluate((planting: boolean) => {
    document.getElementById("eb-planted-drag")?.remove();
    if (!planting) return true;
    const box = document.querySelector(".wm-controls")?.getBoundingClientRect();
    if (!box) return false;
    const cover = document.createElement("div");
    cover.id = "eb-planted-drag";
    cover.style.cssText = `position: fixed; left: ${box.left - 4}px; top: ${box.top - 4}px; width: ${box.width + 8}px; height: ${box.height + 8}px; z-index: 2147483647; -webkit-app-region: drag; --electrobun-app-region: drag`;
    document.body.append(cover);
    return true;
  }, on);
const layoutNow = (d: Driver): Promise<string> => d.evaluate(() => `${document.documentElement.hasAttribute("data-tabs") ? "tabs" : "sidebar"} ${innerWidth}x${innerHeight}`, null);
const settleAt = async (d: Driver, win: string, size: Size): Promise<void> => {
  if (iconic(win)) {
    spawnSync("wmctrl", ["-i", "-a", win], { stdio: "ignore" });
    await until("the window back from minimized", 10_000, async () => (!iconic(win) ? true : null));
  }
  if (maximized(win)) {
    spawnSync("wmctrl", ["-i", "-r", win, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window no longer maximized", 10_000, async () => (!maximized(win) ? true : null));
  }
  if ((await layoutNow(d)) !== layoutOf(size)) spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${size.width},${size.height}`], { stdio: "ignore" });
  await until(`the window back at ${layoutOf(size)}`, 10_000, async () => ((await layoutNow(d)) === layoutOf(size) ? true : null));
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
    await until("the first-run dialog closed", 10_000, async () => (await d.evaluate(() => !document.querySelector("dialog[open]"), null)) || null);

    const sizes: Size[] = [
      { name: "wide (tabs)", width: 1280, height: 800, layout: "tabs" },
      { name: "medium", width: 1000, height: 760, layout: "tabs" },
      { name: "narrow", width: 700, height: 760, layout: "sidebar" },
    ];
    for (const size of sizes) {
      await startFrames(d);
      spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${size.width},${size.height}`], { stdio: "ignore" });
      const frames = await until(`every animation frame from before the ${size.name} resize to ${FRAMES_MS / 1000}s on`, FRAMES_MS + 10_000, () => framesDone(d));
      console.log(`${size.name}: ${frames.length} animation frames from before the resize on: ${runs(frames).join("; ")}`);
      const states = frames.map((f) => f.split("\t")[1] ?? "");
      const bad = runs(frames).filter((r) => !/ no-drag,no-drag,no-drag ×/.test(r));
      if (bad.length) problems.push(`${size.name}: in a frame from before the resize on, a control was missing, covered or not no-drag: ${bad.join("; ")}`);
      if (!states.at(-1)?.startsWith(`${layoutOf(size)} `))
        problems.push(`${size.name}: the last frame was ${states.at(-1) ?? "none"}, not the ${layoutOf(size)} layout, so the frames ended before the resize settled`);
      await until(`the ${layoutOf(size)} layout`, 10_000, async () => ((await layoutNow(d)) === layoutOf(size) ? true : null));
      const c = await until(`the window controls in the ${size.name} layout`, 10_000, () => controls(d));
      shot(size.name.replace(/\W+/g, "-").replace(/-+$/, ""));
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

      if (size.width >= 1280) console.log(`${size.name}: the window already fills the screen, so Maximize and Restore are clicked at the smaller sizes`);
      else if (await realClick(d, win, size.name, 1, layoutOf(size), "Maximize maximizes the window", () => maximized(win))) {
        await until("the button reads Restore after Maximize", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
        await until("the maximized layout", 10_000, async () => ((await layoutNow(d)) === "tabs 1280x800" ? true : null));
        await realClick(d, win, `${size.name}, maximized`, 1, "tabs 1280x800", "Restore restores the window", () => !maximized(win));
        await until("the button reads Maximize after Restore", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));
      }
      await settleAt(d, win, size);
      await realClick(d, win, size.name, 0, layoutOf(size), "Minimize iconifies the window", () => iconic(win));
      await settleAt(d, win, size);
    }
    const narrow = sizes[2]!;

    spawnSync("wmctrl", ["-i", "-r", win, "-b", "add,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager maximizes the window", 10_000, async () => (maximized(win) ? true : null));
    await until("the button reads Restore after the window manager maximized it", 10_000, async () => ((await label(d)) === "Restore window" ? true : null));
    spawnSync("wmctrl", ["-i", "-r", win, "-b", "remove,maximized_vert,maximized_horz"], { stdio: "ignore" });
    await until("the window manager restores the window", 10_000, async () => (!maximized(win) ? true : null));
    await until("the button reads Maximize after the window manager restored it", 10_000, async () => ((await label(d)) === "Maximize window" ? true : null));

    await settleAt(d, win, narrow);
    if (!(await plantDrag(d, true))) problems.push("negative control: no controls to plant a drag cover over");
    else {
      const planted = await until("the window controls under the planted cover", 10_000, () => controls(d));
      const through = await clickActs(d, win, "negative control (a planted drag cover over the controls)", 0, layoutOf(narrow), "Minimize iconifies the window through the cover", () => iconic(win));
      console.log(`negative control: regions ${planted.regions.join(", ")}; a real click on Minimize ${through?.acted ? "still acted" : "didn't act"}`);
      if (!planted.regions.every((r) => r === "drag")) problems.push(`negative control: a planted drag cover over the controls read ${planted.regions.join(", ")}, not drag`);
      if (!through || through.acted) problems.push("negative control: a real click through a planted drag cover still reached Minimize, so this check can't see a covered control");
      await plantDrag(d, false);
      await settleAt(d, win, narrow);
      let settled = false;
      for (let tries = 0; tries < 3 && !settled; tries++) settled = await pageHearsClick(d, win);
      console.log(`after the negative control: ${settled ? "a real click mid-page reaches the page again" : "real clicks still don't reach the page"}`);
      if (!settled) throw new Error("harness: after the negative control's press on a drag region, real clicks never reached the page again, so Close can't be judged");
    }
    await settleAt(d, win, narrow);
    await realClick(d, win, "narrow, last", 2, layoutOf(narrow), "Close takes the window off the screen", () => sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]) === "");
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
