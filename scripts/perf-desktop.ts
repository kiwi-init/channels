import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { appExecutable, attach, launch as launchApp, processesOf, stop, testEnv, webkitHelpers, type Driver } from "../desktop/scripts/eb-drive.ts";
import { daemonStop } from "../desktop/src/daemon-client.ts";
import type { StartupMarks } from "../desktop/src/eb-startup.ts";
import { startLocalRelay } from "./local-relay.ts";
import { calibrateInPage, loopInPage } from "./perf-calibrate.ts";

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`The packaged desktop app's cold start, measured: from launching the executable to its window, its first screen, the first cached message
of the channel it reopens on screen, and live, PERF_RUNS times (5) after one run that makes a channel with PERF_MESSAGES messages (20) on a local relay,
and leaves it open. A launch that doesn't reopen that channel fails. It runs in a temp user data dir and a temp KIWI_HOME (and on Linux a temp HOME), with a mock keychain on a Mac: it never touches
the real app. Each launch also times perf-scale's CPU calibration in the app's page; the medians are scaled by it to the reference runner in
scripts/perf-budgets.json, and it fails when one is over its gate there (the limits whose source is desktop). The report also has loopMs, a
pure-JS loop timed in the same page that doesn't depend on the engine's DOM speed, for comparing runners; nothing is gated on it.

With --electrobun, the app is a Channels.app built with CHANNELS_EB_TEST=1 (so com.kiwiinit.channels.test), driven through its test
driver's socket instead of CDP, with ~/Library and HOME in one temp home (CFFIXED_USER_HOME and HOME) and the relay given by KIWI_EB_RELAY.

  bun scripts/perf-desktop.ts <packaged app executable> [--json out.json]
  bun scripts/perf-desktop.ts <Channels.app> --electrobun [--json out.json]`);
  process.exit(process.argv[2] ? 0 : 2);
}

const ELECTROBUN = process.argv.includes("--electrobun");
const exe = ELECTROBUN ? appExecutable(process.argv[2]) : resolve(process.argv[2]);
if (!existsSync(exe)) {
  console.error(`no app at ${exe}`);
  process.exit(2);
}
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 20);
const at = process.argv.indexOf("--json");
const OUT = at > 0 ? process.argv[at + 1] : undefined;

const root = mkdtempSync(join(tmpdir(), "kiwi-perf-desktop-"));
const home = join(root, ".kiwi");
const userData = join(root, "user-data");
mkdirSync(userData, { recursive: true });
const env: NodeJS.ProcessEnv = { ...process.env, KIWI_HOME: home };
if (process.platform === "linux") Object.assign(env, { HOME: root, XDG_CONFIG_HOME: join(root, ".config"), XDG_DATA_HOME: join(root, ".local", "share") });
delete env["ELECTRON_RUN_AS_NODE"];
delete env["NODE_OPTIONS"];
const flags = [
  `--user-data-dir=${userData}`,
  "--remote-debugging-port=0",
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  ...(process.platform === "darwin" ? ["--use-mock-keychain"] : []),
];

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);

async function until<T>(what: string, ms: number, probe: () => Promise<T | null> | T | null): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got !== null) return got;
    if (Date.now() > end) throw new Error(`${what}: nothing after ${ms / 1000}s`);
    await later(25);
  }
}

interface Running {
  started: number;
  evaluate<A, R>(fn: (arg: A) => R | Promise<R>, arg: A, ms?: number): Promise<R>;
  firstRun(relay: string): Promise<void>;
  where(): Promise<string>;
  startup(): Promise<StartupMarks | null>;
  quit(): Promise<void>;
}

async function stopApp(app: ChildProcess): Promise<void> {
  await stop(app);
  await daemonStop(home, 2_000).catch(() => undefined);
  await later(500);
}

async function firstRunWithPlaywright(page: Page, relay: string): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  type Bridge = { kiwi: { relayUrl: string; setRelayUrl: (u: string) => Promise<string> } };
  await page.evaluate((url) => void (window as unknown as Bridge).kiwi.setRelayUrl(url), relay).catch(() => undefined);
  await until("the app on the local relay", 30_000, () =>
    page
      .evaluate(() => (window as unknown as Bridge).kiwi.relayUrl)
      .then((url) => (url.startsWith(relay) ? true : null))
      .catch(() => null),
  );
  await page.getByRole("textbox", { name: "Your name" }).fill("Jonatas", { timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  const chrome = page.getByRole("banner", { name: "Channels" }).or(page.getByRole("complementary"));
  await chrome.getByRole("button", { name: "New channel", exact: true }).filter({ visible: true }).first().click({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("textbox").fill("cold");
  await page.getByRole("button", { name: "Create channel" }).click();
  const composer = page.getByRole("textbox", { name: "Message" });
  for (let i = 0; i < MESSAGES; i++) {
    await composer.fill(`Message ${i + 1}: the relay deploy is done, numbers in a minute.`);
    await composer.press("Enter");
    await page
      .getByText(`Message ${i + 1}:`)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 15_000 });
  }
}

async function launchElectron(): Promise<Running> {
  rmSync(join(userData, "DevToolsActivePort"), { force: true });
  const started = Date.now();
  const app = spawn(exe, flags, { env, stdio: "ignore", detached: true });
  const port = await until("the app's DevTools port", 60_000, () => {
    try {
      return Number(readFileSync(join(userData, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
    } catch {
      // Not written yet: the app is still starting.
      return null;
    }
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(
    "the window",
    60_000,
    () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => !p.url().startsWith("devtools:")) ?? null,
  );
  return {
    started,
    evaluate: <A, R>(fn: (arg: A) => R | Promise<R>, arg: A) => page.evaluate(fn as (arg: unknown) => R | Promise<R>, arg as unknown),
    firstRun: (relay) => firstRunWithPlaywright(page, relay),
    where: async () => `${page.url()}\n${(await page.evaluate(() => document.body.innerText).catch(() => null)) ?? "(no page text)"}`,
    startup: async () => null,
    quit: async () => {
      await browser.close().catch(() => undefined);
      await stopApp(app);
    },
  };
}

const fillIn = ({ selector, value }: { selector: string; value: string }): boolean => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
};

const clickButton = ({ name, within }: { name: string; within: string }): boolean => {
  const button = [...document.querySelectorAll<HTMLButtonElement>(`${within} button`)].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim() === name && b.getClientRects().length > 0 && !b.disabled,
  );
  button?.click();
  return !!button;
};

const sendMessage = (text: string): boolean => {
  if (document.body.innerText.includes(text)) return true;
  const el = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
  if (!el || el.disabled) return false;
  if (el.value === text) el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  else {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return false;
};

async function firstRunWithDriver(d: Driver): Promise<void> {
  const step = (what: string, ms: number, act: () => Promise<boolean>) =>
    until(what, ms, () =>
      act().then(
        (done) => (done ? true : null),
        () => null,
      ),
    );
  const probe = 2_000;
  await step("the name field", 60_000, () => d.evaluate(fillIn, { selector: 'input[aria-label="Your name"]', value: "Jonatas" }, probe));
  await step("Continue", 10_000, () => d.evaluate(clickButton, { name: "Continue", within: "body" }, probe));
  await step("New channel", 60_000, () => d.evaluate(clickButton, { name: "New channel", within: "body" }, probe));
  await step("the new channel's name", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input', value: "cold" }, probe));
  await step("Create channel", 10_000, () => d.evaluate(clickButton, { name: "Create channel", within: '[role="dialog"]' }, probe));
  for (let i = 0; i < MESSAGES; i++) {
    await step(`message ${i + 1}, sent and in the conversation`, 60_000, () => d.evaluate(sendMessage, `Message ${i + 1}: the relay deploy is done, numbers in a minute.`, probe));
  }
}

async function settled(): Promise<string> {
  const from = Date.now();
  let left = processesOf(exe);
  const lingered = left.length;
  while (left.length && Date.now() - from < 5_000) {
    await later(100);
    left = processesOf(exe);
  }
  if (left.length) throw new Error(`the last launch left ${left.length} process(es) of the app running: ${left.join("; ")}`);
  const waited = lingered ? `, after ${lingered} of its processes took ${Date.now() - from} ms to go` : "";
  return `nothing of the app left running${waited}, ${webkitHelpers()} WebKit helpers on the machine`;
}

async function launchElectrobun(relay: string): Promise<Running> {
  log(await settled());
  const socket = join(root, "driver.sock");
  const started = Date.now();
  const app = launchApp(exe, testEnv(root, socket, relay));
  const d = await attach(socket);
  return {
    started,
    evaluate: (fn, arg, ms) => d.evaluate(fn, arg, ms),
    firstRun: () => firstRunWithDriver(d),
    where: async () => (await d.evaluate(() => `${location.href}\n${document.body.innerText}`, null).catch(() => null)) ?? "(no page)",
    startup: async () => (await d.main("startup").catch(() => null)) as StartupMarks | null,
    quit: async () => {
      d.close();
      await stopApp(app);
    },
  };
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const launch = (): Promise<Running> => (ELECTROBUN ? launchElectrobun(RELAY) : launchElectron());
const runs: {
  windowMs: number;
  firstScreenMs: number;
  firstMessageMs: number;
  liveMs: number;
  calibrationMs: number;
  loopMs: number;
  startup?: Record<string, number>;
  page?: Record<string, number>;
}[] = [];
let running: Running | null = null;
try {
  log("first run: a person, a channel and its messages on the local relay");
  running = await launch();
  await running.firstRun(RELAY);
  await later(3_000);
  await running.quit();
  running = null;

  for (let i = 0; i < RUNS; i++) {
    running = await launch();
    const app = running;
    const screen = await until("the first screen", 60_000, () =>
      app
        .evaluate(
          () => {
            const paint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
            return paint === undefined ? null : { origin: performance.timeOrigin, paint };
          },
          null,
          2_000,
        )
        .catch(() => null),
    );
    const reopened = await until("the channel it had open, reopened on launch, with its first message and live", 20_000, () =>
      app
        .evaluate(
          () => {
            const mark = (name: string) => performance.getEntriesByName(name, "mark")[0]?.startTime;
            const message = mark("kiwi:first-message");
            const live = mark("kiwi:live");
            return message === undefined || live === undefined ? null : { message, live };
          },
          null,
          2_000,
        )
        .catch(() => null),
    );
    const run = {
      windowMs: Math.round(screen.origin - app.started),
      firstScreenMs: Math.round(screen.origin + screen.paint - app.started),
      firstMessageMs: Math.round(screen.origin + reopened.message - app.started),
      liveMs: Math.round(screen.origin + reopened.live - app.started),
      calibrationMs: (await app.evaluate(calibrateInPage, null)).ms,
      loopMs: await app.evaluate(loopInPage, null),
      page: Object.fromEntries(
        Object.entries(
          await app.evaluate(
            () =>
              Object.fromEntries(
                performance
                  .getEntriesByType("mark")
                  .filter((m) => m.name.startsWith("kiwi:"))
                  .map((m) => [m.name.slice(5), performance.timeOrigin + m.startTime]),
              ),
            null,
          ),
        ).map(([k, v]) => [k, Math.round(v - app.started)]),
      ),
      ...(await app.startup().then((marks) => (marks ? { startup: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round(v - app.started)])) } : {}))),
    };
    runs.push(run);
    log(`run ${i + 1}`, JSON.stringify(run));
    await app.quit();
    running = null;
  }
} catch (e) {
  const where = await running?.where().catch(() => null);
  console.error(`where it stopped:\n${where?.slice(0, 1500) ?? "(no window)"}`);
  throw e;
} finally {
  if (running) await running.quit();
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}

const { reference, limits } = JSON.parse(readFileSync(resolve(import.meta.dir, "perf-budgets.json"), "utf8")) as {
  reference: { "@1x": number; loop: number };
  limits: Record<string, { what: string; at: string[]; budget: number; gate: number | null; source?: string }>;
};
const calibrationMs = median(runs.map((r) => r.calibrationMs));
const loopMs = median(runs.map((r) => r.loopMs));
const factor = reference["@1x"] / calibrationMs;
const loopFactor = reference.loop / loopMs;
const measured: Record<string, number> = {
  windowMs: median(runs.map((r) => r.windowMs)),
  firstScreenMs: median(runs.map((r) => r.firstScreenMs)),
  firstMessageMs: median(runs.map((r) => r.firstMessageMs)),
  liveMs: median(runs.map((r) => r.liveMs)),
};
const scaled = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, Math.round(v * factor)]));
const loopScaled = Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, Math.round(v * loopFactor)]));
const marks = [...new Set(runs.flatMap((r) => Object.keys(r.startup ?? {})))];
const startup = Object.fromEntries(marks.map((k) => [k, median(runs.flatMap((r) => (r.startup?.[k] === undefined ? [] : [r.startup[k]])))]));
const report = {
  app: ELECTROBUN ? "electrobun" : "electron",
  runs: runs.length,
  calibrationMs,
  loopMs,
  reference: reference["@1x"],
  loopReference: reference.loop,
  measured,
  scaled,
  loopScaled,
  ...(marks.length ? { startup } : {}),
  each: runs,
};
console.log(JSON.stringify(report, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

const over = Object.values(limits).flatMap((l) => {
  const v = l.source === (ELECTROBUN ? "desktop-eb" : "desktop") ? scaled[l.at[0] ?? ""] : undefined;
  return v !== undefined && l.gate !== null && v > l.gate
    ? [`${l.what}: ${v} ms scaled to the reference runner (calibration ${calibrationMs} ms against ${reference["@1x"]}), over its gate ${l.gate} (budget ${l.budget})`]
    : [];
});
for (const o of over) console.error(o);
if (over.length) process.exit(1);
