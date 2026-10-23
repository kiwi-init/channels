import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { daemonStop } from "../desktop/src/daemon-client.ts";
import { startLocalRelay } from "./local-relay.ts";

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`The packaged desktop app's cold start, measured: from launching the executable to its window, its first paint, the first cached message
on screen and the channel live, PERF_RUNS times (5) after one run that makes a channel with PERF_MESSAGES messages (20) on a local relay.
It runs in a temp user data dir and a temp KIWI_HOME (and on Linux a temp HOME), with a mock keychain on a Mac: it never touches the real app.
Fails when the median launch to first message is over the coldStartMs gate in scripts/perf-budgets.json.

  bun scripts/perf-desktop.ts <packaged app executable> [--json out.json]`);
  process.exit(process.argv[2] ? 0 : 2);
}

const exe = resolve(process.argv[2]);
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
  app: ChildProcess;
  started: number;
  browser: Browser;
  page: Page;
}

async function launch(): Promise<Running> {
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
  return { app, started, browser, page };
}

async function quit(r: Running): Promise<void> {
  await r.browser.close().catch(() => undefined);
  const exited = new Promise<void>((done) => (r.app.exitCode !== null ? done() : r.app.once("exit", () => done())));
  try {
    process.kill(-r.app.pid!, "SIGTERM");
  } catch {
    r.app.kill("SIGTERM");
  }
  await Promise.race([exited, later(10_000)]);
  if (r.app.exitCode === null && r.app.signalCode === null) {
    try {
      process.kill(-r.app.pid!, "SIGKILL");
    } catch {
      r.app.kill("SIGKILL");
    }
  }
  await daemonStop(home, 2_000).catch(() => undefined);
  await later(500);
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const runs: { windowMs: number; firstPaintMs: number; firstMessageMs: number; liveMs: number }[] = [];
let running: Running | null = null;
try {
  log("first run: a person, a channel and its messages on the local relay");
  running = await launch();
  let page = running.page;
  await page.waitForLoadState("domcontentloaded");
  type Bridge = { kiwi: { relayUrl: string; setRelayUrl: (u: string) => Promise<string> } };
  await page.evaluate((url) => void (window as unknown as Bridge).kiwi.setRelayUrl(url), RELAY).catch(() => undefined);
  await until("the app on the local relay", 30_000, () =>
    page
      .evaluate(() => (window as unknown as Bridge).kiwi.relayUrl)
      .then((url) => (url.startsWith(RELAY) ? true : null))
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
      .first()
      .waitFor({ timeout: 15_000 });
  }
  await later(3_000);
  await quit(running);
  running = null;

  for (let i = 0; i < RUNS; i++) {
    running = await launch();
    page = running.page;
    const started = running.started;
    const marks = await until("the first message and the live connection", 60_000, () =>
      page
        .evaluate(() => {
          const mark = (name: string) => performance.getEntriesByName(name, "mark")[0]?.startTime;
          const message = mark("kiwi:first-message");
          const live = mark("kiwi:live");
          const paint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
          return message === undefined || live === undefined || paint === undefined ? null : { origin: performance.timeOrigin, message, live, paint };
        })
        .catch(() => null),
    );
    const run = {
      windowMs: Math.round(marks.origin - started),
      firstPaintMs: Math.round(marks.origin + marks.paint - started),
      firstMessageMs: Math.round(marks.origin + marks.message - started),
      liveMs: Math.round(marks.origin + marks.live - started),
    };
    runs.push(run);
    log(`run ${i + 1}`, JSON.stringify(run));
    await quit(running);
    running = null;
  }
} catch (e) {
  const text = await running?.page.evaluate(() => document.body.innerText).catch(() => null);
  console.error(`where it stopped (${running?.page.url() ?? "no window"}):\n${text?.slice(0, 1500) ?? "(no page text)"}`);
  throw e;
} finally {
  if (running) await quit(running);
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}

const report = {
  runs: runs.length,
  windowMs: median(runs.map((r) => r.windowMs)),
  firstPaintMs: median(runs.map((r) => r.firstPaintMs)),
  firstMessageMs: median(runs.map((r) => r.firstMessageMs)),
  liveMs: median(runs.map((r) => r.liveMs)),
  each: runs,
};
console.log(JSON.stringify(report, null, 2));
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

const { limits } = JSON.parse(readFileSync(resolve(import.meta.dir, "perf-budgets.json"), "utf8")) as { limits: Record<string, { what: string; budget: number; gate: number | null }> };
const limit = limits["coldStartMs"];
if (limit?.gate != null && report.firstMessageMs > limit.gate) {
  console.error(`${limit.what}: ${report.firstMessageMs} ms, over its gate ${limit.gate} (budget ${limit.budget})`);
  process.exit(1);
}
