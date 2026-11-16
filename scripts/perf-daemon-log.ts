import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { heapStats } from "bun:jsc";
import { benchArgs, claimWork } from "./perf-daemon-log-args.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = benchArgs(process.argv);
if ("why" in args) {
  console.error(`perf-daemon-log: ${args.why}`);
  process.exit(2);
}
const { work: WORK, seats: SEATS, perCycle: PER_CYCLE, cycles: CYCLES, rate: RATE, settleMs: SETTLE_MS, body: BODY } = args;

if (process.argv.includes("--relay")) {
  const { startRelay } = await import("../src/relay/bun.ts");
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(WORK, "relay"), devNoRateLimits: true });
  console.log(`relay ${server.url.origin}`);
  await new Promise(() => {});
}

if (process.argv.includes("--send")) {
  const { Channel } = await import("@kiwi/core/client.ts");
  const given = JSON.parse(readFileSync(join(WORK, "sender.json"), "utf8"));
  const ch = new Channel(given.access, given.relay, given.owner);
  const text = "x".repeat(BODY);
  const n = PER_CYCLE;
  const gap = 1000 / RATE;
  for (let i = 0; i < n; i++) {
    const at = Date.now();
    await ch.send(`m${i} ${text}`);
    const left = gap - (Date.now() - at);
    if (left > 0) await Bun.sleep(left);
  }
  process.exit(0);
}

const taken = claimWork(WORK);
if (taken) {
  console.error(`perf-daemon-log: ${taken}`);
  process.exit(2);
}
const home = join(WORK, "home");
const data = join(WORK, "relay");
mkdirSync(home);
mkdirSync(data);
process.env.KIWI_HOME = home;

const { Channel } = await import("@kiwi/core/client.ts");
const { generateIdentity } = await import("@kiwi/core/identity.ts");
const { saveConfig, saveIdentity } = await import("../src/config.ts");
const { AgentSession, runAgent } = await import("../src/agent.ts");

const relayProc = Bun.spawn(["bun", import.meta.path, "--relay", "--work", WORK], { cwd: ROOT, stdout: "pipe", stderr: "inherit" });
const reader = relayProc.stdout.getReader();
let said = "";
while (!/relay (\S+)\n/.test(said)) {
  const { value, done } = await reader.read();
  if (done) throw new Error(`the relay exited: ${said}`);
  said += new TextDecoder().decode(value);
}
const relay = /relay (\S+)\n/.exec(said)?.[1];
process.on("exit", () => relayProc.kill());
process.on("SIGTERM", () => process.exit(143));
process.on("SIGINT", () => process.exit(130));
if (!relay) throw new Error(`the relay didn't say its address: ${said}`);
const owner = await generateIdentity("human");
const agents = await Promise.all(Array.from({ length: SEATS }, (_, i) => generateIdentity(`seat${i}`)));
const made = await Channel.create(
  relay,
  owner,
  { name: "human" },
  agents.map((a) => ({ ...a, info: { name: a.name } })),
);
const [first] = agents;
if (!first) throw new Error("--seats must be at least 1");
const access = await Channel.resume(relay, made.code, first);
const cfg = { ...access, relay, code: made.code, as: first.name };
saveConfig({ channels: { bench: cfg } });
for (const a of agents) saveIdentity(a, made.access.roomId);
writeFileSync(join(WORK, "sender.json"), JSON.stringify({ access: made.access, relay, owner }));

const sessions = await Promise.all(agents.map((a) => AgentSession.open("bench", cfg, a.name)));

const privateDirtyKb = (): number => Number(/^Private_Dirty:\s+(\d+)/m.exec(readFileSync("/proc/self/smaps_rollup", "utf8"))?.[1] ?? NaN);
const logLength = (s: object): number => (Reflect.get(s, "log") as unknown[] | null)?.length ?? 0;

let looks = 0;
let lookMs = 0;
const look = async (): Promise<void> => {
  const at = performance.now();
  for (const s of sessions) {
    const { messages, state } = await runAgent(s.state());
    await runAgent(s.unreadAt(state, messages));
  }
  looks++;
  lookMs += performance.now() - at;
};

let startCounts: Record<string, number> | undefined;
const sample = (phase: string, cycle: number): void => {
  Bun.gc(true);
  const h = heapStats();
  const lens = sessions.map(logLength);
  const counts = h.objectTypeCounts;
  startCounts ??= counts;
  const from = startCounts;
  const grew = Object.entries(counts)
    .map(([type, n]) => [type, n - (from[type] ?? 0)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(
    JSON.stringify({
      phase,
      cycle,
      sent: cycle * PER_CYCLE,
      gc: "forced",
      privateDirtyMb: +(privateDirtyKb() / 1024).toFixed(1),
      heapMb: +(h.heapSize / 1048576).toFixed(1),
      objects: h.objectCount,
      logMin: Math.min(...lens),
      logMax: Math.max(...lens),
      lookMs: looks ? Math.round(lookMs / looks) : 0,
      grew: Object.fromEntries(grew),
    }),
  );
  looks = 0;
  lookMs = 0;
};

console.log(JSON.stringify({ sessionsPid: process.pid, relayPid: relayProc.pid, seats: SEATS, perCycle: PER_CYCLE, cycles: CYCLES, rate: RATE, body: BODY, settleMs: SETTLE_MS }));
await look();
sample("start", 0);
for (let c = 1; c <= CYCLES; c++) {
  const sender = Bun.spawn(["bun", import.meta.path, "--send", "--work", WORK, "--per-cycle", String(PER_CYCLE), "--rate", String(RATE), "--body", String(BODY)], {
    cwd: ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  let done = false;
  void sender.exited.then(() => (done = true));
  while (!done) {
    await look();
    await Bun.sleep(250);
  }
  await look();
  sample("active", c);
  const until = Date.now() + SETTLE_MS;
  while (Date.now() < until) {
    await look();
    await Bun.sleep(1000);
  }
  sample("settled", c);
}

process.exit(0);
