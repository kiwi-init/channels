import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { cpus, release, totalmem, tmpdir } from "node:os";
import { join } from "node:path";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "../desktop/scripts/eb-drive.ts";
import { clickButton, fillIn, gone, sendMessage } from "../desktop/scripts/eb-first-run.ts";
import { daemonStop } from "../desktop/src/daemon-client.ts";
import { AgentSession } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";
import { startLocalRelay } from "./local-relay.ts";
import { changes, GROUPS, sampleOf, settings, stats, webDrops, type Group, type ProcRead, type Sample, type Settings } from "./perf-pss-samples.ts";
import { cliIn, PERF_BASE_LARGE, say, SEEDED, seedChannel, TEXTS } from "./perf-seed.ts";

if (process.argv.includes("--help") || !process.argv[2]) {
  console.log(`The desktop app's memory on Linux over time, as #2629 measured it: PSS from /proc/PID/smaps_rollup of each of its processes.

It starts a test build (CHANNELS_EB_TEST=1) on a local relay, makes a channel in the app, lets PERF_AGENTS agents (10) in, and seeds
perf-scale's large base (600 tasks with 7 notes each, 4000 messages). Then agents post one message every PSS_MESSAGE_SEC seconds (6),
round robin, for PSS_WARM_MIN minutes (5, not sampled) and PSS_LIVE_MIN minutes (40, sampled), and post nothing for PSS_IDLE_MIN
minutes (10, sampled). It samples every PSS_EVERY_SEC seconds (30), with no forced GC and no inspector. The web process's top mappings
are kept at the first sample and at the highest one. A process that starts or ends in the sampled phases is a restart, and the report
says so.

  xvfb-run -a bun scripts/perf-desktop-pss.ts <test build dir> --label v2026.11.30 [--json out.json]`);
  process.exit(process.argv[2] ? 0 : 2);
}

const exe = appExecutable(process.argv[2]);
if (!existsSync(exe)) {
  console.error(`no app at ${exe}`);
  process.exit(2);
}
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const LABEL = flag("--label") ?? "unlabeled";
const OUT = flag("--json");
let SET: Settings;
try {
  SET = settings(process.env, PERF_BASE_LARGE);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(2);
}
const { agents: AGENTS, warmMin: WARM_MIN, liveMin: LIVE_MIN, idleMin: IDLE_MIN, everySec: EVERY_SEC, messageSec: MESSAGE_SEC, seed: SEED } = SET;

const root = mkdtempSync(join(tmpdir(), "kiwi-perf-pss-"));
const appKiwi = join(root, ".kiwi");
const cli = cliIn(join(root, "cli"), "scale");
process.env.KIWI_HOME = cli.home;
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);
const mib = (kb: number) => Math.round(kb / 1024);

const readOr = (path: string, fallback = ""): string => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // A process can end between listing it and reading it: it then counts as gone.
    return fallback;
  }
};
const pssKb = (pid: number): number | null => {
  const kb = /^Pss:\s+(\d+)/m.exec(readOr(`/proc/${pid}/smaps_rollup`))?.[1];
  return kb === undefined ? null : Number(kb);
};
const argsOf = (pid: number): string[] => readOr(`/proc/${pid}/cmdline`).split("\0").filter(Boolean);
const envOf = (pid: number, name: string): string | undefined =>
  readOr(`/proc/${pid}/environ`)
    .split("\0")
    .find((e) => e.startsWith(`${name}=`))
    ?.slice(name.length + 1);
const statOf = (pid: number): { comm: string; session: number; startTicks: number } | null => {
  const s = readOr(`/proc/${pid}/stat`);
  const close = s.lastIndexOf(")");
  if (close < 0) return null;
  const rest = s.slice(close + 2).split(" ");
  return { comm: s.slice(s.indexOf("(") + 1, close), session: Number(rest[3]), startTicks: Number(rest[19]) };
};
const TICKS = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
const BOOT = Number(/^btime (\d+)/m.exec(readOr("/proc/stat"))?.[1] ?? 0);
const startedAt = (ticks: number) => new Date((BOOT + ticks / TICKS) * 1000).toISOString();

interface Proc {
  pid: number;
  group: Group;
  comm: string;
  started: string;
}

function processes(session: number): Proc[] {
  const out: Proc[] = [];
  for (const name of readdirSync("/proc")) {
    const pid = Number(name);
    if (!Number.isInteger(pid)) continue;
    const st = statOf(pid);
    if (!st) continue;
    const args = argsOf(pid);
    const daemon = args.includes("daemon") && envOf(pid, "KIWI_HOME") === appKiwi;
    if (st.session !== session && !daemon) continue;
    const group: Group = daemon ? "daemon" : st.comm.startsWith("WebKitWebProc") ? "web" : st.comm.startsWith("WebKitNetwork") ? "network" : st.comm === "bun" ? "shell" : "other";
    out.push({ pid, group, comm: st.comm, started: startedAt(st.startTicks) });
  }
  return out;
}

function mappings(pid: number): string[] {
  const pss = new Map<string, { kb: number; maps: number }>();
  let name = "";
  for (const line of readOr(`/proc/${pid}/smaps`).split("\n")) {
    const head = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
    if (head) {
      name = head[1] || "[anon]";
      const e = pss.get(name) ?? { kb: 0, maps: 0 };
      e.maps++;
      pss.set(name, e);
      continue;
    }
    const kb = /^Pss:\s+(\d+)/.exec(line);
    if (kb) pss.get(name)!.kb += Number(kb[1]);
  }
  return [...pss]
    .sort((a, b) => b[1].kb - a[1].kb)
    .slice(0, 15)
    .map(([n, e]) => `${mib(e.kb)} MiB, ${e.maps} maps: ${n}`);
}

function webkitOf(pid: number): { library: string | null; pkgConfig: string | null } {
  const library = /(\/\S*\/lib(?:webkit2gtk|webkitgtk)-[\d.]+\.so\S*)/.exec(readOr(`/proc/${pid}/maps`))?.[1] ?? null;
  let pkgConfig: string | null = null;
  for (const name of ["webkit2gtk-4.1", "webkitgtk-6.0"]) {
    try {
      pkgConfig = `${name} ${execFileSync("pkg-config", ["--modversion", name], { encoding: "utf8" }).trim()}`;
      break;
    } catch {
      // That WebKitGTK has no development files here: try the next name, or report only the library.
    }
  }
  return { library, pkgConfig };
}

const run = (what: string, ms: number, act: () => Promise<boolean>) =>
  until(what, ms, () =>
    act().then(
      (done) => (done ? true : null),
      () => null,
    ),
  );
const probe = 2_000;

const inviteCode = (): string | null => {
  const text = [...document.querySelectorAll('[role="dialog"] code, dialog code')].map((e) => e.textContent ?? "").find((t) => t.includes("#mc2-"));
  return text ? text.trim().replace(/^.*#/, "") : null;
};
const closeDialog = (): boolean => {
  const open = document.querySelector<HTMLElement>('[role="dialog"]:has(code), dialog[open]:has(code)');
  if (!open) return true;
  open.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return false;
};
const needsYou = (): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('nav[aria-label="Views"] button')].find((x) => /^Needs you/.test(x.textContent?.trim() ?? ""));
  if (!b) return false;
  if (b.getAttribute("aria-pressed") !== "true") b.click();
  return true;
};
const letInOne = (): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("button")].find((x) => /^It matches: let .+ in$/.test((x.getAttribute("aria-label") ?? x.textContent ?? "").trim()));
  b?.click();
  return !!b;
};
const approve = (): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("article.spec-need button")].find((x) => (x.getAttribute("aria-label") ?? x.textContent ?? "").trim() === "Approve" && !x.disabled);
  b?.click();
  return !!b;
};
const approved = (): boolean => !document.querySelector("article.spec-need");
const general = (): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('section[aria-label="Rooms"] button')].find((x) => x.textContent?.includes("general"));
  b?.click();
  return !!b && !!document.querySelector(".main .composer textarea");
};

async function makeChannel(d: Driver): Promise<string> {
  await run("the onboarding", 60_000, () => d.evaluate(clickButton, { name: "continue", within: ".onb" }, probe));
  await run("the onboarding's second screen", 10_000, () => d.evaluate(clickButton, { name: "continue", within: ".onb:has(.onb-wire)" }, probe));
  await run("the onboarding closes", 10_000, () => d.evaluate(gone, { selector: "dialog.onb" }, probe));
  await run("the name field", 60_000, () => d.evaluate(fillIn, { selector: 'input[aria-label="Your name"]', value: "Jonatas" }, probe));
  await run("Continue", 10_000, () => d.evaluate(clickButton, { name: "Continue", within: "body" }, probe));
  await run("New channel", 60_000, () => d.evaluate(clickButton, { name: "New channel", within: "body" }, probe));
  await run("the new channel's name", 10_000, () => d.evaluate(fillIn, { selector: '[role="dialog"] input', value: "scale" }, probe));
  await run("Create channel", 10_000, () => d.evaluate(clickButton, { name: "Create channel", within: '[role="dialog"]' }, probe));
  await run("the channel's composer", 30_000, () => d.evaluate(() => !!document.querySelector(".main .composer textarea") && !!document.querySelector(".main .thread-doc"), null, probe));
  await run("Invite people", 15_000, () => d.evaluate(clickButton, { name: "Invite people", within: "body" }, probe));
  const code = await until("the invite code", 15_000, () => d.evaluate(inviteCode, null, probe).catch(() => null));
  await run("the invite closes", 10_000, () => d.evaluate(closeDialog, null, probe));
  return code;
}

async function letAgentsIn(d: Driver, waiting: () => boolean): Promise<void> {
  const end = Date.now() + 180_000;
  while (waiting()) {
    if (Date.now() > end) throw new Error(`the agents were not let in in time; the page shows ${await d.evaluate(() => document.body.innerText.slice(0, 600), null).catch(() => "(no page)")}`);
    await d.evaluate(needsYou, null, probe).catch(() => false);
    await d.evaluate(letInOne, null, probe).catch(() => false);
    await later(200);
  }
  await run("the general room", 30_000, () => d.evaluate(general, null, probe));
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const socket = join(root, "driver.sock");
const launchedAt = Date.now();
const app = launch(exe, testEnv(root, socket, RELAY));
const report: Record<string, unknown> = { label: LABEL, app: exe };
let posting = false;
let livePosted = 0;
try {
  const d = await attach(socket);
  log(`${LABEL}: the app is up`);
  const code = await makeChannel(d);
  const agents = Array.from({ length: AGENTS }, (_, i) => `agent${i}`);
  let joined = 0;
  const joining = Promise.all(agents.map((agent) => cli.kiwi(["join", code, "scale", "--as", agent, "--model", "claude-opus-5-5", "--relay", RELAY]).then(() => void joined++)));
  await letAgentsIn(d, () => joined < AGENTS);
  await joining;
  log(`${AGENTS} agents in`);
  const seats = await Promise.all(agents.map((agent) => AgentSession.open("scale", loadConfig().channels["scale"]!, agent)));
  const seedStart = Date.now();
  await seedChannel(
    seats,
    {
      ask: async (text) => {
        await run("the ask, sent", 60_000, () => d.evaluate(sendMessage, { text, shows: text }, probe));
      },
      approveSpec: async () => {
        await run("Needs you", 60_000, () => d.evaluate(needsYou, null, probe));
        await run("Approve", 60_000, () => d.evaluate(approve, null, probe));
        await run("the spec, approved", 60_000, () => d.evaluate(approved, null, probe));
        await run("the general room", 30_000, () => d.evaluate(general, null, probe));
      },
    },
    { ...SEED, sent: (n) => void (n % 1000 === 0 && log(`${n} messages`)), tasksAdded: (n) => void log(`${n} tasks`) },
  );
  await until("the seeded message in the app", 120_000, () => d.evaluate((t: string) => (document.body.innerText.includes(t) ? true : null), SEEDED, probe).catch(() => null));
  const seedSeconds = Math.round((Date.now() - seedStart) / 1000);
  log(`seeded in ${seedSeconds}s`);
  d.close();

  posting = true;
  const poster = (async () => {
    for (let n = 0; posting; n++) {
      const next = Date.now() + MESSAGE_SEC * 1000;
      await say(seats[n % seats.length]!, `L${n}: ${TEXTS[n % TEXTS.length]}`);
      livePosted++;
      await later(Math.max(0, next - Date.now()));
    }
  })();
  log(`warm-up: ${WARM_MIN} min, live`);
  await later(WARM_MIN * 60_000);

  const session = app.pid!;
  const first = processes(session);
  const web = first.filter((p) => p.group === "web");
  if (!web.length) throw new Error(`no WebKitWebProcess in the app's session: ${first.map((p) => p.comm).join(", ")}`);
  report.environment = {
    kernel: release(),
    ramGiB: Math.round((totalmem() / 2 ** 30) * 10) / 10,
    cpu: cpus()[0]?.model ?? null,
    cores: cpus().length,
    runner: { name: process.env.RUNNER_NAME ?? null, imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null, runId: process.env.GITHUB_RUN_ID ?? null },
    webkit: webkitOf(web[0]!.pid),
    appUptimeAtFirstSampleSec: Math.round((Date.now() - launchedAt) / 1000),
    processes: first,
  };
  report.workload = {
    seed: { preset: SEED.tasks === PERF_BASE_LARGE.tasks && SEED.messages === PERF_BASE_LARGE.messages && SEED.taskNotes === PERF_BASE_LARGE.taskNotes ? "large" : "custom", agents: AGENTS, ...SEED },
    seedSeconds,
    messageEverySec: MESSAGE_SEC,
    phasesMin: { warmUp: WARM_MIN, live: LIVE_MIN, idle: IDLE_MIN },
    sampleEverySec: EVERY_SEC,
  };
  report.mappingsAtFirst = Object.fromEntries(web.map((p) => [p.pid, mappings(p.pid)]));

  const samples: Sample[] = [];
  const restarts: string[] = [];
  let peak = -1;
  const total = SET.totalSamples;
  const liveSamples = SET.liveSamples;
  for (let i = 0; i < total; i++) {
    const tick = Date.now() + EVERY_SEC * 1000;
    if (i === liveSamples) {
      posting = false;
      await poster;
      log(`idle: ${IDLE_MIN} min, nothing posted (${livePosted} live messages)`);
    }
    const reads: Partial<Record<Group, ProcRead[]>> = {};
    for (const p of processes(session)) (reads[p.group] ??= []).push({ pid: p.pid, started: p.started, kb: pssKb(p.pid) });
    const sample = sampleOf(new Date().toISOString(), i < liveSamples ? "live" : "idle", reads);
    const before = samples.at(-1);
    if (before) restarts.push(...changes(before, sample));
    samples.push(sample);
    if (sample.valid && sample.pss.web! > peak) {
      peak = sample.pss.web!;
      report.mappingsAtPeak = { at: sample.at, mib: peak, ...Object.fromEntries(sample.procs.web.map((r) => [r.pid, mappings(r.pid)])) };
    }
    log(`[${i + 1}/${total}] ${GROUPS.map((g) => `${g} ${sample.pss[g] ?? "?"}`).join("  ")} MiB${sample.valid ? "" : `  INVALID: ${sample.problems.join("; ")}`}`);
    await later(Math.max(0, tick - Date.now()));
  }
  posting = false;
  await poster;

  const valid = samples.filter((x) => x.valid);
  const invalid = samples.filter((x) => !x.valid).map((x) => `${x.at} ${x.problems.join("; ")}`);
  const series = samples.map((x) => x.pss.web);
  const drops = webDrops(samples);
  report.workload = { ...(report.workload as object), livePosted };
  report.perProcessMiB = Object.fromEntries(GROUPS.map((g) => [g, stats(valid.map((x) => x.pss[g]!))]));
  report.validSamples = valid.length;
  report.invalidSamples = invalid;
  report.webDrops = drops;
  report.webSeries = series;
  report.restarts = restarts;
  report.samples = samples;
  console.log(`\n${LABEL}: MiB PSS (min / median / max)`);
  for (const [g, x] of Object.entries(report.perProcessMiB as Record<string, ReturnType<typeof stats>>)) console.log(`  ${g.padEnd(8)} ${x ? `${x.min} / ${x.median} / ${x.max}` : "no valid sample"}`);
  console.log(`  web drops of 300 MiB or more: ${drops.map((x) => `${x.from} → ${x.to} at ${x.at.slice(11, 19)}`).join(", ") || "none"}`);
  if (restarts.length) console.log(`  restarts: ${restarts.join("; ")}`);
  if (invalid.length) {
    console.error(`  ${invalid.length} of ${samples.length} samples are invalid and left out of the numbers: ${invalid.join("; ")}`);
    process.exitCode = 1;
  }
} finally {
  posting = false;
  if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
  await stop(app).catch(() => undefined);
  await daemonStop(appKiwi, 5_000).catch(() => undefined);
  cli.stop();
  await stopDaemon(daemonSock(cli.home)).catch(() => undefined);
  relay.kill();
  rmSync(root, { recursive: true, force: true });
}
