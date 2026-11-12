import { spawnSync } from "node:child_process";
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
    const win = sh(["xdotool", "search", "--class", "^Channels"]);
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

const click = (win: string, x: number, y: number, times: number): void => {
  spawnSync("xdotool", ["mousemove", "--window", win, String(Math.round(x)), String(Math.round(y)), "click", "--repeat", String(times), "--delay", "120"], { stdio: "ignore" });
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
      const hit = await d.evaluate((at: { x: number; y: number }) => {
        const seen: string[] = [];
        Reflect.set(window, "kiwiPresses", seen);
        const name = (el: Element | null) =>
          el
            ? `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
                .trim()
                .replace(/\s+/g, ".")}`
            : "nothing";
        for (const type of ["pointerdown", "mousedown", "mouseup", "click"])
          document.addEventListener(type, (e) => void seen.push(`${type} on ${name(e.target as Element)} at ${Math.round((e as MouseEvent).clientX)},${Math.round((e as MouseEvent).clientY)}`), true);
        const chain: string[] = [];
        for (let el = document.elementFromPoint(at.x, at.y); el; el = el.parentElement) chain.push(`${name(el)}[${getComputedStyle(el).getPropertyValue("--electrobun-app-region").trim() || "-"}]`);
        return `viewport ${innerWidth}x${innerHeight}; at ${Math.round(at.x)},${Math.round(at.y)}: ${chain.slice(0, 6).join(" < ")}`;
      }, gear);
      console.log(`${layout.name}: window ${sh(["xdotool", "getwindowgeometry", win]).replace(/\s+/g, " ")}; ${hit}`);
      click(win, gear.x, gear.y, 1);
      try {
        await until(`Settings opens on a real click in the ${layout.name} layout`, 10_000, async () => (await d.evaluate(() => !!document.querySelector(".set"), null)) || null);
      } finally {
        console.log(`${layout.name}: the page saw ${JSON.stringify(await d.evaluate(() => Reflect.get(window, "kiwiPresses"), null))}`);
      }
      click(win, gear.x, gear.y, 1);
      await until(
        `Settings closes on the gear's second click in the ${layout.name} layout`,
        10_000,
        async () => ((await d.evaluate(() => !!document.querySelector(".set"), null)) ? null : true) || null,
      );
      const before = sh(["xdotool", "getwindowgeometry", "--shell", win]);
      click(win, gear.x, gear.y, 2);
      await Bun.sleep(1500);
      const after = sh(["xdotool", "getwindowgeometry", "--shell", win]);
      const state = sh(["xprop", "-id", win, "_NET_WM_STATE"]);
      if (state.includes("MAXIMIZED")) problems.push(`${layout.name}: a double-click on the gear maximized the window (${state})`);
      if (before !== after) problems.push(`${layout.name}: a double-click on the gear moved or resized the window (${before} -> ${after})`);
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
console.log("ok: a real click on the gear opens Settings, and a double-click neither maximizes nor moves the window");
