import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

const linux = process.platform === "linux";
if (!process.argv[2] || !linux || !process.env.DISPLAY) {
  console.error("usage (on Linux under Xvfb): xvfb-run -a -s '-screen 0 1280x800x24' bun desktop/scripts/eb-native-click.ts <Channels built with CHANNELS_EB_TEST=1>");
  process.exit(2);
}

const sh0 = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};
const withWm = process.argv.includes("--wm");
if (withWm) {
  spawn("openbox", [], { stdio: "ignore", detached: true });
  await until("openbox managing the screen", 15_000, async () => (sh0(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"]).includes("window id") ? true : null));
}
console.log(`window manager: ${withWm ? "openbox" : "none"}`);

const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-native-click-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];

const sh = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

const windowOf = (): string => {
  for (let i = 0; i < 60; i++) {
    const win = sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]);
    if (win) {
      const id = win.split("\n")[0]!;
      console.log(`window: ${sh(["xprop", "-id", id, "WM_CLASS"])}`);
      return id;
    }
    if (i === 59) problems.push("no window with a Channels WM_CLASS within 30s");
    else Bun.sleepSync(500);
  }
  return "";
};

const app = launch(exe, env);
try {
  const d = await attach(join(root, "driver.sock"));
  try {
    await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
    const win = windowOf();
    if (!win) throw new Error(problems.join("; "));
    console.log(`session: X11 under Xvfb (${process.env.DISPLAY})`);
    await firstChannel(d, 0);
    await d.evaluate(() => {
      const root = document.documentElement;
      root.dataset.heard = "";
      for (const type of ["pointerdown", "mousedown", "click"])
        addEventListener(type, (e) => (root.dataset.heard += ` ${type}@${Math.round((e as MouseEvent).clientX)},${Math.round((e as MouseEvent).clientY)}`), true);
    }, null);
    console.log(`probe xwininfo:\n${sh(["xwininfo", "-id", win])}`);
    console.log(`probe root children:\n${sh(["xwininfo", "-root", "-children"])}`);
    console.log(`probe WM_STATE / _NET_WM_STATE: ${sh(["xprop", "-id", win, "WM_STATE", "_NET_WM_STATE", "_NET_WM_WINDOW_TYPE"])}`);
    spawnSync("xdotool", ["mousemove", "--window", win, "640", "400"], { stdio: "ignore" });
    Bun.sleepSync(200);
    console.log(`probe pointer after mousemove: ${sh(["xdotool", "getmouselocation", "--shell"]).replace(/\n/g, " ")}`);
    spawnSync("xdotool", ["click", "1"], { stdio: "ignore" });
    Bun.sleepSync(600);
    const heard = await d.evaluate(() => document.documentElement.dataset.heard ?? "", null);
    console.log(`probe the page heard: ${heard.trim() || "nothing"}`);
    if (!heard.includes("click@")) problems.push(`harness: a real mid-page click never reached the page (heard: ${heard.trim() || "nothing"})`);
    for (const layout of [
      { name: "wide (tabs)", width: 1280, height: 800 },
      { name: "narrow (sidebar)", width: 700, height: 800 },
    ]) {
      spawnSync("xdotool", ["windowsize", win, String(layout.width), String(layout.height)], { stdio: "ignore" });
      await until(`the ${layout.name} layout settled`, 10_000, async () => {
        const r = await d.evaluate(() => (document.documentElement.hasAttribute("data-tabs") ? "tabs" : "sidebar"), null);
        return (layout.name.startsWith("wide") ? r === "tabs" : r === "sidebar") || null;
      });
      const gear = await until(`the Settings gear on screen in the ${layout.name} layout`, 30_000, async () => {
        const r = await d.evaluate(() => {
          const g = document.querySelector(".rail-gear");
          if (!g) return null;
          const b = g.getBoundingClientRect();
          return b.width > 0 ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
        }, null);
        return r ?? null;
      });
      await until(
        `the gear works when the page dispatches its own click (${layout.name} control)`,
        10_000,
        async () => (await d.evaluate(() => !!document.querySelector(".rail-gear")?.dispatchEvent(new MouseEvent("click", { bubbles: true })) && !!document.querySelector(".set"), null)) || null,
      );
      await until(
        `the control's Settings closes (${layout.name})`,
        10_000,
        async () =>
          (await d.evaluate(() => {
            const g = document.querySelector(".rail-gear");
            if (g && document.querySelector(".set")) g.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            return !document.querySelector(".set");
          }, null)) || null,
      );
      const press = await d.evaluate((at: { x: number; y: number }) => {
        const name = (el: Element) =>
          `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
            .trim()
            .replace(/\s+/g, ".")}`;
        const hit = document.elementFromPoint(at.x, at.y);
        const chain: string[] = [];
        let decides: string | null = null;
        for (let el = hit; el; el = el.parentElement) {
          const region = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
          chain.push(`${name(el)}[${region || "-"}]`);
          if (!decides && (region === "drag" || region === "no-drag")) decides = region;
        }
        return { onGear: !!hit && !!document.querySelector(".rail-gear")?.contains(hit), decides, chain: chain.slice(0, 6).join(" < ") };
      }, gear);
      console.log(`${layout.name}: under the gear at ${Math.round(gear.x)},${Math.round(gear.y)}: ${press.chain}`);
      if (!press.onGear) problems.push(`${layout.name}: something else is on top of the gear (${press.chain})`);
      if (press.decides === "drag") problems.push(`${layout.name}: a press on the gear starts a window move: its nearest app region is drag (${press.chain})`);
    }
  } finally {
    d.close();
  }
} finally {
  await stop(app);
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}

if (problems.length) {
  for (const p of problems) console.error(`eb-native-click: ${p}`);
  process.exit(1);
}
console.log("ok: the gear opens and closes Settings, and a press on it never starts a window move, in both layouts");
