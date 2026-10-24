import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appExecutable, attach, launch as launchApp, processesOf, stop, testEnv, webkitHelpers } from "../desktop/scripts/eb-drive.ts";
import { firstChannel } from "../desktop/scripts/eb-first-run.ts";
import { daemonStop } from "../desktop/src/daemon-client.ts";
import type { StartupMarks } from "../desktop/src/eb-startup.ts";
import { startLocalRelay } from "./local-relay.ts";
import { calibrateInPage, loopInPage } from "./perf-calibrate.ts";

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`The packaged desktop app's cold start, measured: from launching the executable to its window, its first screen, the first cached message
of the channel it reopens on screen, and live, PERF_RUNS times (5) after one run that makes a channel with PERF_MESSAGES messages (20) on a local relay,
and leaves it open. A launch that doesn't reopen that channel fails. Each launch also times perf-scale's CPU calibration in the app's page; the medians are scaled by it to the reference runner in
scripts/perf-budgets.json, and it fails when one is over its gate there (the limits whose source is desktop). The report also has loopMs, a
pure-JS loop timed in the same page that doesn't depend on the engine's DOM speed, for comparing runners; nothing is gated on it.

The app is a Channels.app built with CHANNELS_EB_TEST=1 (so com.kiwiinit.channels.test), driven through its test driver's socket,
with ~/Library and HOME in one temp home (CFFIXED_USER_HOME and HOME) and the relay given by KIWI_EB_RELAY: it never touches the real app.

  bun scripts/perf-desktop.ts <Channels.app> [--json out.json]`);
  process.exit(process.argv[2] ? 0 : 2);
}

const exe = appExecutable(process.argv[2]);
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
    firstRun: () => firstChannel(d, MESSAGES),
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
const launch = (): Promise<Running> => launchElectrobun(RELAY);
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
  app: "electrobun",
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
  const v = l.source === "desktop-eb" ? scaled[l.at[0] ?? ""] : undefined;
  return v !== undefined && l.gate !== null && v > l.gate
    ? [`${l.what}: ${v} ms scaled to the reference runner (calibration ${calibrationMs} ms against ${reference["@1x"]}), over its gate ${l.gate} (budget ${l.budget})`]
    : [];
});
for (const o of over) console.error(o);
if (over.length) process.exit(1);
