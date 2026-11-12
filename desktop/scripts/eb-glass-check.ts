import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

if (!process.argv[2] || !process.argv[3] || process.platform !== "darwin") {
  console.error("usage (on a Mac, on CI: it changes the wallpaper while it runs): bun desktop/scripts/eb-glass-check.ts <Channels.app built with CHANNELS_EB_TEST=1> <folder for the captures>");
  process.exit(2);
}
const exe = appExecutable(process.argv[2]);
const bundle = `${resolve(process.argv[2]).replace(/\.app(\/.*)?$/, ".app")}/Contents/`;
const out = resolve(process.argv[3]);
const root = mkdtempSync(join(tmpdir(), "kiwi-glass-check-"));
const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const env = testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`);
const problems: string[] = [];
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MESSAGES = 30;
const ROUNDS = 4;
const STEP = 30;
const FRAMES = 150;

type Mode = "opaque" | "glass" | "reduced";
interface Scrolled {
  frames: number;
  moved: number;
  ms: number;
  p50: number;
  p95: number;
  max: number;
  late: number;
}
interface Cpu {
  server: number;
  app: number;
  web: number;
}
interface Run extends Scrolled, Cpu {
  mode: Mode;
  what: "scroll" | "still";
}
interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
  screen: number;
  page: { x: number; y: number; width: number; height: number } | null;
  top: number;
}

async function run<T>(what: (d: Driver) => Promise<T>): Promise<T> {
  const app = launch(exe, env);
  try {
    const d = await attach(join(root, "driver.sock"));
    try {
      await until("the window on screen", 60_000, async () => ((await d.main("window")) as { visible?: unknown }).visible === true || null);
      return await what(d);
    } finally {
      d.close();
    }
  } finally {
    await stop(app);
  }
}

const pickTheme = (): boolean => {
  if (!document.querySelector("dialog.onb")) return false;
  localStorage.setItem("mc.appearance", "dark");
  localStorage.setItem("ui.prefs", JSON.stringify({ darkTheme: "channels-oled" }));
  for (const moved of ["ui.prefs.oled", "ui.prefs.cinder", "ui.prefs.channels-dark"]) localStorage.setItem(moved, "1");
  return true;
};

const themeKept = (): string => `${localStorage.getItem("mc.appearance")} ${localStorage.getItem("ui.prefs")}`;

const standIn = ({ on }: { on: boolean }): string => {
  const page = document.documentElement;
  if (on) {
    page.style.setProperty("--frame", "color-mix(in srgb, var(--bg-3) 55%, transparent)");
    document.body.style.setProperty("background", "transparent");
  } else {
    page.style.removeProperty("--frame");
    document.body.style.removeProperty("background");
  }
  return page.dataset.glass ?? "none";
};

const feedHeight = (): { travel: number; rows: number } | null => {
  let feed = document.querySelector<HTMLElement>(".main article.msg")?.parentElement ?? null;
  while (feed && !(feed.scrollHeight > feed.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(feed).overflowY))) feed = feed.parentElement;
  if (!feed) return null;
  feed.scrollTop = feed.scrollHeight;
  return { travel: feed.scrollHeight - feed.clientHeight, rows: document.querySelectorAll(".main article.msg").length };
};

const scrolled = async ({ dy, frames }: { dy: number; frames: number }): Promise<Scrolled | null> => {
  let feed = document.querySelector<HTMLElement>(".main article.msg")?.parentElement ?? null;
  while (feed && !(feed.scrollHeight > feed.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(feed).overflowY))) feed = feed.parentElement;
  if (!feed) return null;
  const scroller = feed;
  scroller.scrollTop = scroller.scrollHeight;
  const at: number[] = [];
  let moved = 0;
  await new Promise<void>((done) => {
    let left = frames * 2;
    const frame = (t: number) => {
      at.push(t);
      const before = scroller.scrollTop;
      scroller.scrollTop += left > frames ? -dy : dy;
      moved += Math.abs(scroller.scrollTop - before);
      left -= 1;
      if (left > 0) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
  const gaps = at
    .slice(1)
    .map((t, i) => t - at[i]!)
    .sort((a, b) => a - b);
  const pct = (p: number) => gaps[Math.min(gaps.length - 1, Math.floor((p / 100) * gaps.length))] ?? 0;
  return { frames: gaps.length, moved, ms: at.at(-1)! - at[0]!, p50: pct(50), p95: pct(95), max: gaps.at(-1) ?? 0, late: gaps.filter((g) => g > pct(50) * 1.5).length };
};

const placed = (): Placed => {
  const card = document.querySelector<HTMLElement>(".main");
  const r = card?.getBoundingClientRect();
  return {
    x: window.screenX,
    y: window.screenY,
    width: window.innerWidth,
    height: window.innerHeight,
    screen: screen.width,
    page: r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null,
    top: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-h")) || 0,
  };
};

function cpu(): Cpu {
  const used: Cpu = { server: 0, app: 0, web: 0 };
  for (const line of execFileSync("ps", ["-Ao", "cputime=,command="], { encoding: "utf8" }).split("\n")) {
    const m = /^\s*([\d:.]+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const seconds = m[1]!.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
    const command = m[2]!;
    if (/\/WindowServer( |$)/.test(command)) used.server += seconds;
    else if (command.includes("/com.apple.WebKit.")) used.web += seconds;
    else if (command.includes(bundle)) used.app += seconds;
  }
  return used;
}

async function looksLike(d: Driver, want: string): Promise<void> {
  await until(`the window looks "${want}"`, 10_000, async () => (String(await d.main("looks")).startsWith(want) ? true : null));
}

async function show(d: Driver, mode: Mode): Promise<void> {
  if (mode === "glass") {
    await d.main("frostForTest");
    await d.main("clearForTest");
    await looksLike(d, "frost clear");
    await until('the page marked data-glass="material"', 10_000, async () => ((await d.evaluate(standIn, { on: true })) === "material" ? true : null));
  } else {
    await d.main("solidForTest");
    await d.main(mode === "opaque" ? "opaqueForTest" : "clearForTest");
    await looksLike(d, mode === "opaque" ? "solid drawn" : "solid clear");
    await until("the page without its glass mark", 10_000, async () => ((await d.evaluate(standIn, { on: false })) === "none" ? true : null));
  }
  await later(600);
}

async function measured(d: Driver, mode: Mode, what: "scroll" | "still", frames: number): Promise<Run | null> {
  const before = cpu();
  const got = await d.evaluate(scrolled, { dy: what === "scroll" ? STEP : 0, frames }, 60_000);
  const after = cpu();
  if (!got) return null;
  return { mode, what, ...got, server: after.server - before.server, app: after.app - before.app, web: after.web - before.web };
}

function wallpaperImage(name: string, colors: readonly (readonly [number, number, number])[]): string {
  const width = 960;
  const height = 600;
  const row = (width * 3 + 3) & ~3;
  const bmp = Buffer.alloc(54 + row * height);
  bmp.write("BM", 0);
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colors[Math.floor((x + y) / 96) % colors.length]!;
      const at = 54 + y * row + x * 3;
      bmp[at] = b;
      bmp[at + 1] = g;
      bmp[at + 2] = r;
    }
  const raw = join(root, `${name}.bmp`);
  const png = join(root, `${name}.png`);
  writeFileSync(raw, bmp);
  execFileSync("sips", ["-s", "format", "png", raw, "--out", png], { stdio: "ignore" });
  return png;
}

const WALLPAPER_SCRIPT = `ObjC.import("AppKit");
function run(argv) {
  const space = $.NSWorkspace.sharedWorkspace;
  const screens = ObjC.unwrap($.NSScreen.screens);
  const was = screens.length ? ObjC.unwrap(space.desktopImageURLForScreen(screens[0]).path) : "";
  if (argv[0]) for (const s of screens) if (!space.setDesktopImageURLForScreenOptionsError($.NSURL.fileURLWithPath(argv[0]), s, $.NSDictionary.dictionary, null)) throw new Error("the wallpaper was refused");
  return was;
}
`;

function wallpaper(path: string): string {
  const script = join(root, "wallpaper.js");
  writeFileSync(script, WALLPAPER_SCRIPT);
  const done = spawnSync("osascript", ["-l", "JavaScript", script, path], { encoding: "utf8" });
  if (done.status !== 0) throw new Error(`the wallpaper can't be set: ${done.stderr.trim()}`);
  return done.stdout.trim();
}

interface Shot {
  width: number;
  height: number;
  mean: (x: number, y: number, w: number, h: number) => number;
}

function capture(name: string): Shot | null {
  const png = join(out, `${name}.png`);
  const raw = join(root, `${name}.bmp`);
  const done = spawnSync("screencapture", ["-x", "-t", "png", png], { encoding: "utf8" });
  if (done.status !== 0 || !existsSync(png) || statSync(png).size < 4096) {
    problems.push(`no capture for ${name}: ${done.stderr.trim() || "screencapture wrote nothing"}`);
    return null;
  }
  execFileSync("sips", ["-s", "format", "bmp", png, "--out", raw], { stdio: "ignore" });
  const bmp = readFileSync(raw);
  const start = bmp.readUInt32LE(10);
  const width = bmp.readInt32LE(18);
  const tall = bmp.readInt32LE(22);
  const bytes = bmp.readUInt16LE(28) / 8;
  const row = (width * bytes + 3) & ~3;
  const height = Math.abs(tall);
  const mean = (x: number, y: number, w: number, h: number): number => {
    let sum = 0;
    let n = 0;
    for (let py = Math.max(0, Math.round(y)); py < Math.min(height, Math.round(y + h)); py += 2)
      for (let px = Math.max(0, Math.round(x)); px < Math.min(width, Math.round(x + w)); px += 2) {
        const at = start + (tall > 0 ? height - 1 - py : py) * row + px * bytes;
        sum += (bmp[at]! + bmp[at + 1]! + bmp[at + 2]!) / 3;
        n += 1;
      }
    return n ? sum / n : -1;
  };
  return { width, height, mean };
}

function patches(shot: Shot, at: Placed): { frame: number; page: number; desk: number } {
  const k = shot.width / at.screen;
  const frame = shot.mean((at.x + at.width * 0.3) * k, (at.y + 2) * k, at.width * 0.4 * k, Math.max(4, at.top - 4) * k);
  const page = at.page ? shot.mean((at.x + at.page.x + 8) * k, (at.y + at.page.y + 8) * k, (at.page.width - 16) * k, (at.page.height - 16) * k) : -1;
  const desk = shot.mean(0, 0, shot.width, shot.height);
  return { frame, page, desk };
}

const round = (n: number, digits = 1): number => Number(n.toFixed(digits));
const mid = (list: readonly number[]): number => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)] ?? 0;

mkdirSync(out, { recursive: true });
let before = "";
try {
  await run(async (d) => {
    await until("the onboarding, to pick OLED Black before anything is drawn in it", 60_000, async () => ((await d.evaluate(pickTheme, null, 2_000)) ? true : null));
    await later(2_000);
  });
  await run(async (d) => {
    const kept = await d.evaluate(themeKept, null);
    if (!kept.includes("channels-oled") || !kept.startsWith("dark")) problems.push(`the theme picked before the restart wasn't kept (${kept}), so the captures aren't in OLED Black`);
    await firstChannel(d, 0);
    for (let i = 1; i <= MESSAGES; i++) {
      const shows = `Glass ${i}:`;
      const text = [`${shows} the relay deploy is done.`, ...Array.from({ length: 7 }, (_, line) => `Line ${line + 2} of message ${i}, so the conversation is taller than the window.`)].join("\n\n");
      await until(`message ${i} of ${MESSAGES}, sent and in the conversation`, 60_000, () => d.evaluate(sendMessage, { text, shows }, 2_000).then((sent) => (sent ? true : null)));
    }
    const feed = await until("a conversation taller than the window", 20_000, () => d.evaluate(feedHeight, null, 2_000));
    const frames = Math.min(FRAMES, Math.floor(feed.travel / STEP));
    console.log(`the conversation: ${feed.rows} rows, ${feed.travel} px to scroll; each run goes ${frames * STEP} px up and back, ${STEP} px a frame`);
    if (frames < 60) problems.push(`the conversation only scrolls ${feed.travel} px: too short to measure`);
    console.log(
      `with the system's own setting, glass is ${(await d.main("frostAllowed")) ? "allowed" : "not allowed (Reduce transparency or Increase contrast is on here)"}; window: ${String(await d.main("looks"))}`,
    );

    await show(d, "glass");
    await measured(d, "glass", "scroll", frames);
    const runs: Run[] = [];
    for (let i = 0; i < ROUNDS; i++)
      for (const mode of ["opaque", "glass"] as const) {
        await show(d, mode);
        for (const what of ["scroll", "still"] as const) {
          const got = await measured(d, mode, what, what === "scroll" ? frames : 90);
          if (!got) problems.push(`no frames measured for ${mode}, ${what}`);
          else runs.push(got);
        }
      }
    writeFileSync(join(out, "scroll.json"), JSON.stringify(runs, null, 2));
    console.log("\nscrolling, today's opaque window and the glass one in turn (ms between frames; CPU seconds used while it ran):");
    console.log("| run | window | frames | px moved | fps | p50 | p95 | max | late frames | WindowServer | WebKit | app |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const [i, r] of runs.entries())
      if (r.what === "scroll")
        console.log(
          `| ${Math.floor(i / 4) + 1} | ${r.mode} | ${r.frames} | ${Math.round(r.moved)} | ${round((r.frames / r.ms) * 1000)} | ${round(r.p50)} | ${round(r.p95)} | ${round(r.max)} | ${r.late} | ${round(r.server, 2)} | ${round(r.web, 2)} | ${round(r.app, 2)} |`,
        );
    console.log("\n| median of the runs | window | fps | p95 | late frames | WindowServer CPU s | WebKit CPU s | app CPU s |");
    console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const what of ["scroll", "still"] as const)
      for (const mode of ["opaque", "glass"] as const) {
        const of = runs.filter((r) => r.mode === mode && r.what === what);
        const m = (pick: (r: Run) => number) => mid(of.map(pick));
        console.log(
          `| ${what} | ${mode} | ${round(m((r) => (r.frames / r.ms) * 1000))} | ${round(m((r) => r.p95))} | ${m((r) => r.late)} | ${round(
            m((r) => r.server),
            2,
          )} | ${round(
            m((r) => r.web),
            2,
          )} | ${round(
            m((r) => r.app),
            2,
          )} |`,
        );
      }

    const at = await d.evaluate(placed, null);
    console.log(`\nthe window on screen: ${JSON.stringify(at)}`);
    const bright = wallpaperImage("bright", [
      [255, 255, 255],
      [255, 214, 10],
      [100, 210, 255],
      [255, 255, 255],
      [255, 105, 97],
    ]);
    const dark = wallpaperImage("dark", [
      [0, 0, 0],
      [10, 14, 40],
      [0, 0, 0],
      [30, 8, 36],
    ]);
    before = wallpaper(bright);
    await later(3_000);
    const seen: Record<string, { frame: number; page: number; desk: number }> = {};
    for (const [paper, image] of [
      ["bright", bright],
      ["dark", dark],
    ] as const) {
      wallpaper(image);
      await later(3_000);
      for (const mode of ["glass", "opaque", "reduced"] as const) {
        await show(d, mode);
        await later(600);
        const shot = capture(`mac-${mode}-${paper}`);
        if (shot) seen[`${mode} ${paper}`] = patches(shot, at);
      }
    }
    console.log("\nmean brightness (0 to 255) in each capture: the top bar, the page, the whole screen:");
    for (const [name, p] of Object.entries(seen)) console.log(`  ${name}: frame ${round(p.frame)} · page ${round(p.page)} · screen ${round(p.desk)}`);
    writeFileSync(join(out, "captures.json"), JSON.stringify({ window: at, seen }, null, 2));
    const gap = (mode: Mode, part: "frame" | "page" | "desk"): number | null => {
      const a = seen[`${mode} bright`];
      const b = seen[`${mode} dark`];
      return a && b ? Math.abs(a[part] - b[part]) : null;
    };
    const desk = gap("glass", "desk");
    if (desk !== null && desk < 25) problems.push(`the screen reads the same with the bright and the dark wallpaper (${round(desk)} apart), so the captures prove nothing`);
    const glass = gap("glass", "frame");
    if (glass !== null && glass < 6) problems.push(`the glass frame reads the same over a bright and a dark wallpaper (${round(glass)} apart): nothing shows through`);
    for (const mode of ["glass", "opaque", "reduced"] as const) {
      const page = gap(mode, "page");
      if (page !== null && page > 2) problems.push(`the page changes with the wallpaper in the ${mode} window (${round(page)} apart): it must stay solid`);
    }
    for (const mode of ["opaque", "reduced"] as const) {
      const frame = gap(mode, "frame");
      if (frame !== null && frame > 2) problems.push(`the frame changes with the wallpaper in the ${mode} window (${round(frame)} apart): it must be solid there`);
    }
  });
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
} finally {
  if (before) {
    try {
      wallpaper(before);
    } catch {
      // The run is over and the machine is thrown away on CI: a wallpaper that can't be put back fails nothing.
    }
  }
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("ok: the frame shows the desktop through the window's own material, the page stays solid, and without the material the whole window is solid");
