import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "linux" || !process.env.DISPLAY) {
  console.error(
    "usage (on Linux under Xvfb, with openbox, wmctrl and xdotool installed): xvfb-run -a -s '-screen 0 1280x800x24' bun desktop/scripts/eb-native-click.ts <Channels built with CHANNELS_EB_TEST=1>",
  );
  process.exit(2);
}

const sh = (args: string[]): string => {
  const r = spawnSync(args[0]!, args.slice(1), { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};
const xdo = (...args: string[]): void => void spawnSync("xdotool", args, { stdio: "ignore" });

const wm = spawn("openbox", [], { stdio: "ignore", detached: true });
await until("openbox managing the screen", 15_000, async () => (sh(["xprop", "-root", "_NET_SUPPORTING_WM_CHECK"]).includes("window id") ? true : null));

const exe = appExecutable(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "kiwi-native-click-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];

type Point = { x: number; y: number };
type Place = { x: number; y: number; w: number; h: number; state: string };

const place = (win: string): Place => {
  const g = Object.fromEntries(
    sh(["xdotool", "getwindowgeometry", "--shell", win])
      .split("\n")
      .map((l) => l.split("=") as [string, string]),
  );
  return {
    x: Number(g["X"]),
    y: Number(g["Y"]),
    w: Number(g["WIDTH"]),
    h: Number(g["HEIGHT"]),
    state: sh(["xprop", "-id", win, "_NET_WM_STATE"]).replace(/^_NET_WM_STATE\(ATOM\)\s*=?\s*/, "") || "none",
  };
};
const shown = (p: Place): string => `${p.x},${p.y} ${p.w}x${p.h} state ${p.state}`;
const moved = (a: Place, b: Place): boolean => a.x !== b.x || a.y !== b.y;

const click = (win: string, at: Point, times = 1): void => {
  xdo("mousemove", "--window", win, String(Math.round(at.x)), String(Math.round(at.y)));
  xdo("click", "--repeat", String(times), "--delay", "120", "1");
};
const pressAndDrag = (win: string, at: Point): void => {
  xdo("mousemove", "--window", win, String(Math.round(at.x)), String(Math.round(at.y)));
  xdo("mousedown", "1");
  Bun.sleepSync(150);
  for (let i = 0; i < 6; i++) {
    xdo("mousemove_relative", "--", "15", "10");
    Bun.sleepSync(60);
  }
  xdo("mouseup", "1");
  Bun.sleepSync(400);
};

const heard = (d: Driver): Promise<string> =>
  d.evaluate(() => {
    const root = document.documentElement;
    const was = root.dataset["heard"] ?? "";
    root.dataset["heard"] = "";
    return was.trim();
  }, null);
const settingsOpen = (d: Driver): Promise<boolean> => d.evaluate(() => !!document.querySelector(".set"), null);

const app = launch(exe, env);
try {
  const d = await attach(join(root, "driver.sock"));
  try {
    await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
    const win = await until("a visible Channels window", 30_000, async () => sh(["xdotool", "search", "--onlyvisible", "--class", "^Channels"]).split("\n")[0] || null);
    console.log(`session: X11 under Xvfb (${process.env.DISPLAY}) with openbox; window ${win} ${sh(["xprop", "-id", win, "WM_CLASS"])}`);
    await firstChannel(d, 0);
    await d.evaluate(() => {
      const root = document.documentElement;
      root.dataset["heard"] = "";
      for (const type of ["pointerdown", "mousedown", "click"])
        addEventListener(type, (e) => (root.dataset["heard"] += ` ${type}@${Math.round((e as MouseEvent).clientX)},${Math.round((e as MouseEvent).clientY)}`), true);
    }, null);

    for (const layout of [
      { name: "wide (tabs)", width: 1280, height: 760 },
      { name: "narrow (sidebar)", width: 700, height: 760 },
    ]) {
      spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${layout.width},${layout.height}`], { stdio: "ignore" });
      await until(`the ${layout.name} layout settled`, 10_000, async () => {
        const r = await d.evaluate(() => ({ w: innerWidth, tabs: document.documentElement.hasAttribute("data-tabs") }), null);
        return (r.w === layout.width && r.tabs === layout.name.startsWith("wide")) || null;
      });
      await Bun.sleep(400);

      const middle = await d.evaluate(() => ({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) }), null);
      await heard(d);
      click(win, middle);
      const mid = await until(`a real click mid-page reaching the page (${layout.name})`, 5_000, async () => {
        const h = await heard(d);
        return h.includes("click@") ? h : null;
      }).catch(() => "");
      console.log(`${layout.name}: harness control, a real click mid-page at ${middle.x},${middle.y}: the page heard ${mid || "nothing"}`);
      if (!mid) throw new Error(`harness: a real click mid-page never reached the page in the ${layout.name} layout, so this run can't judge the gear`);

      const gear = await until(`the Settings gear on screen in the ${layout.name} layout`, 30_000, async () =>
        d.evaluate(() => {
          const b = document.querySelector(".rail-gear")?.getBoundingClientRect();
          return b && b.width > 0 ? { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } : null;
        }, null),
      );
      const css = await d.evaluate((at: Point) => {
        const name = (el: Element) =>
          `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
            .trim()
            .replace(/\s+/g, ".")}`;
        const chain: string[] = [];
        let decides = "-";
        for (let el = document.elementFromPoint(at.x, at.y); el; el = el.parentElement) {
          const region = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
          chain.push(`${name(el)}[${region || "-"}]`);
          if (decides === "-" && (region === "drag" || region === "no-drag")) decides = region;
        }
        return { decides, chain: chain.slice(0, 6).join(" < ") };
      }, gear);
      console.log(`${layout.name}: under the gear at ${gear.x},${gear.y}: ${css.chain}`);

      click(win, gear);
      const opened = await until(`Settings opens on a real gear click (${layout.name})`, 5_000, async () => ((await settingsOpen(d)) ? true : null)).catch(() => false);
      if (!opened) problems.push(`${layout.name}: a real click on the gear didn't open Settings (the page heard ${(await heard(d)) || "nothing"})`);
      click(win, gear);
      const closed = await until(`Settings closes on a second real gear click (${layout.name})`, 5_000, async () => ((await settingsOpen(d)) ? null : true)).catch(() => false);
      if (!closed) problems.push(`${layout.name}: a second real click on the gear didn't close Settings`);

      const beforeDouble = place(win);
      click(win, gear, 2);
      await Bun.sleep(1500);
      const afterDouble = place(win);
      console.log(`${layout.name}: a real double-click on the gear: window ${shown(beforeDouble)} -> ${shown(afterDouble)}`);
      if (/MAXIMIZED/.test(afterDouble.state)) problems.push(`${layout.name}: a double-click on the gear maximized the window (${afterDouble.state})`);
      if (moved(beforeDouble, afterDouble) || beforeDouble.w !== afterDouble.w || beforeDouble.h !== afterDouble.h)
        problems.push(`${layout.name}: a double-click on the gear moved or resized the window (${shown(beforeDouble)} -> ${shown(afterDouble)})`);
      if (await settingsOpen(d)) click(win, gear);

      const beforeDrag = place(win);
      pressAndDrag(win, gear);
      const afterDrag = place(win);
      console.log(`${layout.name}: a real press-and-drag from the gear: window ${shown(beforeDrag)} -> ${shown(afterDrag)}`);
      if (moved(beforeDrag, afterDrag))
        problems.push(`${layout.name}: a press-and-drag on the gear moved the window (${shown(beforeDrag)} -> ${shown(afterDrag)}); its nearest app region is ${css.decides} (${css.chain})`);
      spawnSync("wmctrl", ["-i", "-r", win, "-e", `0,0,0,${layout.width},${layout.height}`], { stdio: "ignore" });
      if (await settingsOpen(d)) click(win, gear);
      await Bun.sleep(300);
    }

    spawnSync("wmctrl", ["-i", "-r", win, "-e", "0,0,0,1280,760"], { stdio: "ignore" });
    await until("the wide layout again", 10_000, async () => ((await d.evaluate(() => innerWidth, null)) === 1280 ? true : null));
    await Bun.sleep(400);
    const empty = await d.evaluate(() => {
      const rail = document.querySelector(".top");
      const r = rail?.getBoundingClientRect();
      if (!r) return null;
      const y = Math.round(r.top + r.height / 2);
      for (let x = Math.round(r.right) - 24; x > r.left; x -= 8) {
        let decides = "-";
        let inControl = false;
        for (let el = document.elementFromPoint(x, y); el; el = el.parentElement) {
          if (el.matches("button, a, input, .tile, [role=tab]")) inControl = true;
          const region = getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim();
          if (decides === "-" && (region === "drag" || region === "no-drag")) decides = region;
        }
        if (decides === "drag" && !inControl) return { x, y };
      }
      return null;
    }, null);
    if (!empty) problems.push("no empty drag stretch found in the top bar for the positive control");
    else {
      const before = place(win);
      pressAndDrag(win, empty);
      const after = await until("the window moving after a press-and-drag on the empty tabs rail", 5_000, async () => {
        const now = place(win);
        return moved(before, now) ? now : null;
      }).catch(() => place(win));
      console.log(`positive control, a real press-and-drag on an empty stretch of the tabs rail at ${empty.x},${empty.y}: window ${shown(before)} -> ${shown(after)}`);
      if (!moved(before, after))
        problems.push(`a press-and-drag on an empty stretch of the tabs rail at ${empty.x},${empty.y} didn't move the window, so a still gear proves nothing (${shown(before)})`);
    }
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
  for (const p of problems) console.error(`eb-native-click: ${p}`);
  process.exit(1);
}
console.log(
  "ok: with real X input under openbox, a mid-page click reaches the page, the gear opens and closes Settings, a double-click or a press-and-drag on it leaves the window where it was, and the same press-and-drag on the empty tabs rail moves it, in both layouts",
);
