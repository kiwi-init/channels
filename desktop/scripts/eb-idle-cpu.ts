import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { startLocalRelay } from "../../scripts/local-relay.ts";
import { appExecutable, attach, launch, stop, testEnv } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

const usage = "usage: bun desktop/scripts/eb-idle-cpu.ts <app folder built with CHANNELS_EB_TEST=1> [--seconds 60] [--profile <dir>] [--json <file>]";
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const seconds = Number(flag("--seconds") ?? 60);
const profile = flag("--profile");
const json = flag("--json");
if (!args[0] || process.platform !== "linux" || !(seconds > 0)) {
  console.error(usage);
  process.exit(2);
}

const exe = appExecutable(args[0]);
const root = mkdtempSync(join(tmpdir(), "kiwi-idle-cpu-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const TICK = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;

interface Proc {
  pid: number;
  role: string;
}

function ticks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return Number(rest[11]) + Number(rest[12]);
  } catch {
    return null;
  }
}

function roleOf(comm: string, cmd: string): string | null {
  if (cmd.includes("Resources/main.js")) return "main (bun)";
  if (comm.startsWith("WebKitWebProces")) return "WebKitWebProcess";
  if (comm.startsWith("WebKitNetworkPr")) return "WebKitNetworkProcess";
  if (comm.startsWith("WebKitGPUProces")) return "WebKitGPUProcess";
  if (cmd.includes(root) && / daemon\b/.test(cmd)) return "kiwi daemon";
  return null;
}

function processes(session: number): Proc[] {
  return execFileSync("ps", ["-e", "-o", "pid=,sid=,comm=,args="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
      if (!m) return [];
      const [pid, sid, comm, cmd] = [Number(m[1]), Number(m[2]), m[3]!, m[4]!];
      const role = roleOf(comm, cmd);
      return role && (sid === session || role === "kiwi daemon") ? [{ pid, role }] : [];
    });
}

function threads(pid: number): Map<string, number> {
  const out = new Map<string, number>();
  const tids = (() => {
    try {
      return readdirSync(`/proc/${pid}/task`);
    } catch {
      return [];
    }
  })();
  for (const tid of tids) {
    try {
      const stat = readFileSync(`/proc/${pid}/task/${tid}/stat`, "utf8");
      const name = stat.slice(stat.indexOf("(") + 1, stat.lastIndexOf(")"));
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      out.set(`${name} [${tid}]`, Number(rest[11]) + Number(rest[12]));
    } catch {
      continue;
    }
  }
  return out;
}

function straceFor(pid: number, secs: number, file: string): Promise<string | null> {
  return new Promise((done) => {
    const p = spawn("sudo", ["-n", "strace", "-c", "-f", "-o", file, "-p", String(pid)], { stdio: "ignore" });
    const t = setTimeout(() => p.kill("SIGINT"), secs * 1000);
    p.on("error", () => (clearTimeout(t), done(null)));
    p.on("exit", () => {
      clearTimeout(t);
      setTimeout(() => done(existsSync(file) ? readFileSync(file, "utf8") : null), 500);
    });
  });
}

async function measure(phase: string, session: number, during?: () => Promise<void>): Promise<Record<string, number>> {
  const procs = processes(session);
  const start = new Map(procs.map((p) => [p.pid, ticks(p.pid)]));
  const main = procs.find((p) => p.role === "main (bun)")?.pid;
  const before = main ? threads(main) : new Map<string, number>();
  const t0 = performance.now();
  const end = t0 + seconds * 1000;
  while (performance.now() < end) {
    await (during ? during() : Promise.resolve());
    await later(Math.min(3_000, Math.max(0, end - performance.now())));
  }
  const secs = (performance.now() - t0) / 1000;
  const out: Record<string, number> = {};
  for (const p of procs) {
    const a = start.get(p.pid);
    const b = ticks(p.pid);
    if (a === null || a === undefined || b === null) continue;
    out[p.role] = (out[p.role] ?? 0) + ((b - a) / TICK / secs) * 100;
  }
  console.log(`\n${phase}, ${secs.toFixed(0)} s:`);
  for (const [role, pct] of Object.entries(out).sort((x, y) => y[1] - x[1])) console.log(`  ${pct.toFixed(2).padStart(6)}%  ${role}`);
  if (main) {
    const after = threads(main);
    const busy = [...after]
      .map(([name, t]): [string, number] => [name, ((t - (before.get(name) ?? t)) / TICK / secs) * 100])
      .filter(([, pct]) => pct >= 0.05)
      .sort((x, y) => y[1] - x[1]);
    console.log(`  main's threads: ${busy.map(([name, pct]) => `${name} ${pct.toFixed(2)}%`).join(", ") || "none above 0.05%"}`);
  }
  return out;
}

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const extra: NodeJS.ProcessEnv = {};
if (profile) {
  mkdirSync(resolve(profile), { recursive: true });
  extra.BUN_OPTIONS = `--cpu-prof-md --cpu-prof-dir=${resolve(profile)}`;
}
const app = launch(exe, testEnv(root, join(root, "driver.sock"), `http://127.0.0.1:${port}`, extra));
const results: Record<string, Record<string, number>> = {};
try {
  const d = await attach(join(root, "driver.sock"));
  await later(15_000);
  results.firstRun = await measure("idle on the first-run screen, no channel", app.pid!);
  await firstChannel(d, 3);
  await later(20_000);
  results.idle = await measure("idle, a channel open, nothing new", app.pid!);
  const main = processes(app.pid!).find((p) => p.role === "main (bun)")?.pid;
  const traced = main ? await straceFor(main, 20, json ? join(dirname(resolve(json)), "strace-idle.txt") : join(root, "strace-idle.txt")) : null;
  console.log(traced ? `\nmain's syscalls over 20 s idle:\n${traced.split("\n").slice(0, 16).join("\n")}` : "\nno strace (sudo -n strace not allowed here)");
  let n = 0;
  results.busy = await measure("busy, a message every 3 s", app.pid!, async () => {
    n += 1;
    const text = `Busy ${n}: the build is green, moving on to the next one.`;
    for (let i = 0; i < 10 && !(await d.evaluate(sendMessage, text, 2_000).catch(() => false)); i++) await later(200);
  });
  results.after = await measure("idle again, after the burst", app.pid!);
  if (profile) {
    await d.main("exitForTest").catch(() => undefined);
    await later(5_000);
  }
  d.close();
} finally {
  await stop(app);
  relay.kill();
}
if (json) {
  mkdirSync(dirname(resolve(json)), { recursive: true });
  writeFileSync(json, JSON.stringify({ seconds, results }, null, 2));
}
if (profile && existsSync(profile)) console.log(`\nprofiles: ${readdirSync(profile).join(", ") || "none written"}`);
