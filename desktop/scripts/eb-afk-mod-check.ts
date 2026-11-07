import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startRelay } from "../../src/relay/bun.ts";
import { devHumanAuth } from "../../src/relay/human.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { DEFAULT_MODS } from "../src/mods-default.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel } from "./eb-first-run.ts";

if (!process.argv[2] || process.platform !== "darwin") {
  console.error("usage, on a Mac: bun desktop/scripts/eb-afk-mod-check.ts <the app built with CHANNELS_EB_TEST=1> [screenshot dir]");
  process.exit(2);
}

const bundle = process.argv[2];
const exe = appExecutable(bundle);
const shots = process.argv[3] ?? null;
const root = mkdtempSync(join(tmpdir(), "kiwi-afk-mod-check-"));
const problems: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) problems.push(what);
  console.log(`${ok ? "ok" : "FAIL"} ${what}`);
};
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay"), human: devHumanAuth(), githubPush: null, devNoRateLimits: true });
const RELAY = `http://127.0.0.1:${relay.port}`;

const id = spawnSync("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleIdentifier", join(bundle, "Contents", "Info.plist")], { encoding: "utf8" }).stdout.trim();
const proc = `first process whose bundle identifier is "${id}"`;
const osa = (script: string, lang: "AppleScript" | "JavaScript" = "AppleScript"): string => spawnSync("osascript", ["-l", lang, "-e", script], { encoding: "utf8", timeout: 30_000 }).stdout.trim();
const front = (): void => void osa(`tell application "System Events" to set frontmost of (${proc}) to true`);
const press = (key: string, command = false): void => {
  front();
  osa(`tell application "System Events" to keystroke "${key}"${command ? " using {command down}" : ""}`);
};
const dark = (on: boolean): void => void osa(`tell application "System Events" to tell appearance preferences to set dark mode to ${on}`);

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function windowBox(): Box | null {
  const raw = osa(`tell application "System Events" to get {position, size} of window 1 of (${proc})`);
  const n = raw.split(",").map((v) => Number(v.trim()));
  return n.length === 4 && n.every(Number.isFinite) ? { x: n[0]!, y: n[1]!, width: n[2]!, height: n[3]! } : null;
}

function clickAt(x: number, y: number): void {
  front();
  osa(
    `ObjC.import("CoreGraphics"); const p = $.CGPointMake(${x}, ${y}); for (const t of [$.kCGEventMouseMoved, $.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, t, p, $.kCGMouseButtonLeft)); delay(0.08); }`,
    "JavaScript",
  );
}

const view = (): { width: number; height: number } => ({ width: innerWidth, height: innerHeight });

const afkNow = (): { shown: boolean; leaving: boolean; label: string | null; frame: string | null } => {
  const afk = document.querySelector<HTMLElement>(".afk");
  const f = [...document.querySelectorAll("iframe")].find((e) => e.title.endsWith(" while you're away"));
  const r = f?.getBoundingClientRect();
  return {
    shown: !!afk,
    leaving: !!afk?.classList.contains("is-leaving"),
    label: afk?.getAttribute("aria-label") ?? null,
    frame: f && r && f.style.visibility !== "hidden" ? `${f.title} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} z${f.style.zIndex}` : null,
  };
};

const current = (): string | null => {
  const on = document.querySelector('nav[aria-label="Channels"] button[aria-current="page"]');
  return on?.getAttribute("aria-label")?.split(",")[0] ?? null;
};

const goHome = (): boolean => {
  const b = document.querySelector<HTMLButtonElement>('nav[aria-label="Channels"] button.is-home');
  b?.click();
  return b?.getAttribute("aria-current") === "page";
};

const composer = (text: string | null): string | null => {
  const area = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
  if (!area) return null;
  if (text !== null) {
    area.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return area.value;
};

const pageNow = (): Record<string, unknown> => ({
  afk: document.querySelector(".afk")?.outerHTML.slice(0, 300) ?? null,
  dialog: (document.querySelector('[role="dialog"]')?.textContent ?? null)?.slice(0, 300),
  frames: [...document.querySelectorAll("iframe")].map((f) => `${f.title} ${f.style.width}x${f.style.height} ${f.style.visibility || "shown"}`),
  current: document.querySelector('nav[aria-label="Channels"] button[aria-current="page"]')?.getAttribute("aria-label") ?? null,
  focus: `${document.hasFocus()} ${document.activeElement?.tagName ?? "none"} ${document.activeElement?.getAttribute("title") ?? document.activeElement?.className ?? ""}`,
});

const traceFocus = (): void => {
  const w = window as unknown as { focusTrace?: string[] };
  const t0 = performance.now();
  const log = (what: string): void => {
    const a = document.activeElement;
    w.focusTrace?.push(
      `${Math.round(performance.now() - t0)} ${what} ${a?.tagName ?? "none"}${a?.getAttribute("title") ? ` ${a.getAttribute("title")}` : a?.className ? ` .${String(a.className).split(" ")[0]}` : ""}`,
    );
  };
  w.focusTrace = [];
  for (const type of ["blur", "focus"]) window.addEventListener(type, () => log(`window ${type}`), true);
  for (const type of ["focusin", "focusout"]) document.addEventListener(type, () => log(type), true);
  let n = 0;
  const every = setInterval(() => {
    log("sample");
    if (++n >= 40) clearInterval(every);
  }, 100);
};

const focusTrace = (): string[] => (window as unknown as { focusTrace?: string[] }).focusTrace ?? [];

let driver: Driver | null = null;

const step = (what: string, ms: number, act: () => Promise<boolean>) =>
  until(what, ms, () =>
    act().then(
      (done) => (done ? true : null),
      () => null,
    ),
  ).catch(async (e: unknown) => {
    if (driver) console.log(`the page at "${what}": ${JSON.stringify(await driver.evaluate(pageNow, null, 3_000).catch(String), null, 1)}`);
    throw e;
  });

async function shot(name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const file = join(shots, `${name}.png`);
  const r = spawnSync("screencapture", ["-x", file], { stdio: "ignore" });
  console.log(r.status === 0 && existsSync(file) ? `shot ${file}` : `no shot for ${name} here`);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const s = statSync(p, { throwIfNoEntry: false });
    return s?.isDirectory() ? files(p) : s ? [p] : [];
  });
}

const PROBE = `import { useEffect } from "react"
import { afk, channels, open } from "@kiwi/mod"

function Probe() {
  useEffect(() => {
    const typed = () => {
      const first = channels()?.[0]
      if (first) open({ kind: "channel", code: first.code })
    }
    const pressed = () => window.open("https://example.com/from-the-afk-frame")
    addEventListener("keydown", typed, true)
    addEventListener("pointerdown", pressed, true)
    return () => {
      removeEventListener("keydown", typed, true)
      removeEventListener("pointerdown", pressed, true)
    }
  }, [])
  return <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", font: "600 24px system-ui" }}>probe</div>
}

afk({ after: 0, render: Probe })
`;

const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  driver = d;
  dark(false);
  await firstChannel(d, 0);
  type Mod = { name: string; version: string | null; state: string; why?: string };
  const mods = () => d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<Mod[]> } }).kiwi.mods(), null, 15_000);
  const mod = await until("the AFK mod, installed on first start", 90_000, async () => (await mods()).find((m) => m.name === "afk" && m.state !== "asks") ?? null).catch(async () => {
    console.log(`mods: ${JSON.stringify(await mods().catch(String))}`);
    return null;
  });
  console.log(`the AFK mod: ${JSON.stringify(mod)}`);
  check(mod?.state === "on", "with an empty ~/.kiwi/ the app installs the AFK mod on first start, already approved, and it runs");
  const pin = DEFAULT_MODS.find((p) => p.name === "afk")!;
  const sources = JSON.parse(readFileSync(join(root, ".kiwi", "mods", ".sources.json"), "utf8")) as Record<string, { commit?: string }>;
  check(sources["afk"]?.commit === pin.commit, `it's the copy pinned in the app (kiwi-init/mods@${pin.commit.slice(0, 7)})`);
  await step("the channel", 30_000, () => d.evaluate(() => !!document.querySelector(".chan"), null, 2_000));
  const channel = await d.evaluate(current, null, 2_000);
  console.log(`the channel: ${channel}`);
  await later(4_000);

  const size = await d.evaluate(view, null, 2_000);
  const box = windowBox();
  console.log(`the window: ${JSON.stringify(box)}, the page ${JSON.stringify(size)}`);
  const at = (x: number, y: number): [number, number] => [box!.x + x, box!.y + (box!.height - size.height) + y];

  await d.evaluate(composer, "", 2_000);
  press("t", true);
  const shown = await until("AFK, on ⌘T", 15_000, async () => {
    const r = await d.evaluate(afkNow, null, 2_000);
    return r.shown && r.frame ? r : null;
  }).catch(() => null);
  console.log(`after ⌘T: ${JSON.stringify(shown)}`);
  check(shown?.label === "afk", "⌘T shows AFK, the afk mod's frame over the meadow");
  check(!!shown?.frame?.includes(`0,0 ${size.width}x${size.height}`), `the mod's frame covers the whole window (${shown?.frame})`);
  await later(3_600);
  await shot("afk-light");
  dark(true);
  await later(2_500);
  await shot("afk-dark");
  dark(false);
  await later(1_500);

  press("x");
  const gone = await until("AFK, gone after a key", 10_000, async () => ((await d.evaluate(afkNow, null, 2_000)).shown ? null : true)).catch(() => null);
  check(!!gone, "a key fades it out");
  const typed = await d.evaluate(composer, null, 2_000);
  check(typed === "", `the key that wakes it never reaches the app (the composer holds ${JSON.stringify(typed)})`);

  press("t", true);
  await step("AFK, on ⌘T again", 15_000, async () => !!(await d.evaluate(afkNow, null, 2_000)).frame);
  await later(1_000);
  press("t", true);
  const closed = await until("AFK, gone after ⌘T again", 10_000, async () => ((await d.evaluate(afkNow, null, 2_000)).shown ? null : true)).catch(() => null);
  check(!!closed, "⌘T again closes it");

  await step("Home", 10_000, () => d.evaluate(goHome, null, 2_000));
  press("t", true);
  await step("AFK, from Home", 15_000, async () => !!(await d.evaluate(afkNow, null, 2_000)).frame);
  await later(3_000);
  const glance = Math.max(0.07 * size.height, 24);
  await d.evaluate(traceFocus, null, 2_000);
  clickAt(...at(Math.max(0.05 * size.width, 16) + 80, size.height - glance - 4 - 14));
  const opened = await until("the channel, from AFK's row", 10_000, async () => {
    const [now, on] = await Promise.all([d.evaluate(afkNow, null, 2_000), d.evaluate(current, null, 2_000)]);
    return !now.shown && on === channel ? on : null;
  }).catch(async () => {
    console.log(`after the row click: ${JSON.stringify(await d.evaluate(pageNow, null, 2_000).catch(String))}`);
    return null;
  });
  check(!!opened, `a click on a channel's row (${channel}) opens it, through the mod's open(), and AFK goes`);

  await later(1_000);
  press("t", true);
  const again = await until("AFK, for a click on the sky", 15_000, async () => ((await d.evaluate(afkNow, null, 2_000)).frame ? true : null)).catch(() => null);
  if (!again) {
    console.log(`after the row click, ⌘T did nothing: ${JSON.stringify(await d.evaluate(pageNow, null, 2_000).catch(String))}`);
    console.log(`focus since the row click:\n  ${(await d.evaluate(focusTrace, null, 2_000).catch(() => [] as string[])).join("\n  ")}`);
    await d.evaluate(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", metaKey: true, bubbles: true, cancelable: true })), null, 2_000);
    await later(1_500);
    console.log(`a ⌘T sent inside the page: ${JSON.stringify(await d.evaluate(afkNow, null, 2_000))}`);
  }
  check(!!again, "after a row click, ⌘T shows it again: no focus is left in its hidden frame");
  await step("AFK, for a click on the sky", 15_000, async () => !!(await d.evaluate(afkNow, null, 2_000)).frame);
  await later(1_000);
  clickAt(...at(size.width / 2, 80));
  const sky = await until("AFK, gone after a click on the sky", 10_000, async () => ((await d.evaluate(afkNow, null, 2_000)).shown ? null : true)).catch(() => null);
  check(!!sky, "a click on the sky fades it out");

  await d.evaluate(() => (window as unknown as { kiwi: { setModSetting(n: string, id: string, v: string): Promise<unknown> } }).kiwi.setModSetting("afk", "after", "1 min"), null, 10_000);
  await later(5_000);
  const away = await until("AFK, after a minute away", 120_000, async () => ((await d.evaluate(afkNow, null, 2_000)).frame ? true : null)).catch(() => null);
  check(!!away, "with AFK after set to 1 min in its settings, a minute without the mouse or keys shows it");
  press("x");
  await step("AFK, gone after the wait check", 10_000, async () => !(await d.evaluate(afkNow, null, 2_000)).shown);

  await d.evaluate(() => (window as unknown as { kiwi: { removeMod(n: string, f: boolean): Promise<unknown> } }).kiwi.removeMod("afk", true), null, 15_000);
  const probe = join(root, ".kiwi", "mods", "zz-probe");
  mkdirSync(probe, { recursive: true });
  writeFileSync(join(probe, "mod.json"), JSON.stringify({ name: "zz-probe", version: "1.0.0", shell: "^3.19", needs: ["afk", "channels"] }));
  writeFileSync(join(probe, "index.tsx"), PROBE);
  const probed = await until("the probe mod, approved", 60_000, async () => {
    const list = await d.evaluate(() => (window as unknown as { kiwi: { approveMod(n: string, needs: string[]): Promise<Mod[]> } }).kiwi.approveMod("zz-probe", ["afk", "channels"]), null, 10_000);
    return list.find((m) => m.name === "zz-probe" && m.state === "on") ?? null;
  }).catch(async () => {
    console.log(`mods: ${JSON.stringify(await mods().catch(String))}`);
    return null;
  });
  check(!!probed, "a probe mod with afk and channels runs in AFK's place");
  await later(3_000);
  await step("Home, for the probe", 10_000, () => d.evaluate(goHome, null, 2_000));
  press("t", true);
  await step("the probe's AFK frame", 15_000, async () => !!(await d.evaluate(afkNow, null, 2_000)).frame);
  await later(1_500);
  await d.evaluate(traceFocus, null, 2_000);
  clickAt(...at(size.width / 2, size.height / 2));
  await later(800);
  const stays = await d.evaluate(afkNow, null, 2_000);
  check(stays.shown, "a click inside an AFK frame that doesn't leave keeps it up");
  press("x");
  await step("the probe, gone after a key", 10_000, async () => !(await d.evaluate(afkNow, null, 2_000)).shown);
  const home = await d.evaluate(current, null, 2_000);
  if (home !== "Home") console.log(`focus since the click inside the probe:\n  ${(await d.evaluate(focusTrace, null, 2_000).catch(() => [] as string[])).join("\n  ")}`);
  check(
    home === "Home",
    `after a click inside it, a key still never reaches the AFK frame: the shell takes it and leaves, and the probe's keydown, which would open ${channel}, never runs (now on ${home})`,
  );
  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(!opens.some((u) => u.includes("from-the-afk-frame")), "a link from an AFK frame opens nothing: it can only open a channel");

  check(app.exitCode === null && app.signalCode === null, "the app is still running");
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${problems.at(-1)}`);
} finally {
  dark(false);
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.stop(true);
  for (const f of files(join(root, "home"))) {
    if (!/main\.log$/.test(f)) continue;
    const lines = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /mod|afk|install|refused/i.test(l));
    if (lines.length) console.log(`${f}:\n${lines.join("\n")}`);
  }
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: AFK is a mod the app installs on first start; ⌘T and a minute away show it, keys never reach its frame, and a row opens its channel");
