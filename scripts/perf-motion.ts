import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, letIn, newChannel } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

if (process.argv.includes("--help")) {
  console.log(`Frames while each of the app's animations runs: a thread and a task opening and closing in the panel, a task moving on the board,
the Now card folding, and a dialog closing, on a board of PERF_TASKS tasks (6). Each runs PERF_REPS times (5) with the CPU slowed
PERF_CPU times (4), and reports the frames over 33 ms and 50 ms, the worst frame, and the long animation frames' blocking time: the median, and
the most of any run. --dist DIR measures another build (ui/dist-harness).

  bun scripts/ui-harness.ts && bun scripts/perf-motion.ts [--dist DIR] [--only "board move,dialog close"] [--json out.json]

Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium (or SMOKE_CHROMIUM=<Chrome binary>).`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const REPS = Number(process.env.PERF_REPS ?? 5);
const CPU = Number(process.env.PERF_CPU ?? 4);
const TASKS = Number(process.env.PERF_TASKS ?? 6);
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const DIST = harnessDist(flag("--dist"));
const OUT = flag("--json");
const ONLY = flag("--only")?.split(",");
const data = mkdtempSync(join(tmpdir(), "kiwi-perf-motion-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const running: ChildProcess[] = [];
function kiwi(argv: string[]): Promise<string> {
  const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
  const p = spawn("bun", ["src/cli/main.ts", ...argv], { cwd: ROOT, env });
  running.push(p);
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  return new Promise((ok, fail) =>
    p.on("exit", (code) => {
      running.splice(running.indexOf(p), 1);
      if (code === 0) ok(out);
      else fail(new Error(`kiwi ${argv.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`));
    }),
  );
}
const atlas = (...argv: string[]) => kiwi(["-c", "motion", "--as", "atlas", ...argv]);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const FRAMES = () => {
  const w = window as unknown as { __motion: { on: boolean; deltas: number[]; blocking: number[] } };
  w.__motion = { on: false, deltas: [], blocking: [] };
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      if (w.__motion.on) w.__motion.blocking.push((e as PerformanceEntry & { blockingDuration: number }).blockingDuration);
    }),
  ).observe({ type: "long-animation-frame", buffered: false } as PerformanceObserverInit);
};

interface Run {
  frames: number;
  over33: number;
  over50: number;
  worstMs: number;
  blockingMs: number;
}

async function frames(page: Page, act: () => Promise<unknown>, settleMs = 700): Promise<Run> {
  await page.evaluate(() => {
    const m = (window as unknown as { __motion: { on: boolean; deltas: number[]; blocking: number[] } }).__motion;
    m.deltas = [];
    m.blocking = [];
    m.on = true;
    let last = performance.now();
    const tick = (t: number) => {
      if (!m.on) return;
      m.deltas.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const m = (window as unknown as { __motion: { on: boolean; deltas: number[]; blocking: number[] } }).__motion;
    m.on = false;
    const d = m.deltas.slice(1);
    return {
      frames: d.length,
      over33: d.filter((x) => x > 33).length,
      over50: d.filter((x) => x > 50).length,
      worstMs: Math.round(Math.max(0, ...d)),
      blockingMs: Math.round(m.blocking.reduce((a, b) => a + b, 0)),
    };
  });
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://localhost:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const report: Record<string, Run & { runs: Run[] }> = {};
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(FRAMES);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto(BASE);
  await firstRun(page, "Jonatas");
  const code = await newChannel(page, "motion");
  const views = page.getByRole("navigation", { name: "Views" });
  const toConversation = () => views.getByRole("button", { name: /general/ }).click();
  const toTasks = () => views.getByRole("button", { name: /^Tasks/ }).click();
  let joined = false;
  const joining = kiwi(["join", code, "motion", "--as", "atlas", "--model", "claude-opus-5-5", "--relay", BASE]).then(() => void (joined = true));
  await letIn(page, () => !joined);
  await joining;

  const say = async (body: string): Promise<string> => {
    await page.getByRole("textbox", { name: "Message" }).fill(body);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    const said = (await atlas("log", "-n", "5", "--json")).split("\n").flatMap((l) => (l.trim() ? [JSON.parse(l) as { seq: number; body?: string }] : []));
    return String(said.find((m) => m.body === body)?.seq ?? "");
  };
  const ask = await say("Morning. Can someone check the router numbers?");
  const titles = ["Write fewer rows per message", "Polish the conversation feed", "Cache sealed history in the browser", "Ship 0.8.12", "Trim the relay's cold start", "Move the docs to the site"];
  const ids: string[] = [];
  for (let i = 0; i < TASKS; i++) ids.push(/T(\d+)/.exec(await atlas("task", "add", `${titles[i % titles.length]} (${i + 1})`, "--owner", "atlas", "--ask", ask))![1]!);

  const question = await say("Ship it tonight, or wait for the web?");
  await atlas("send", "On it. I'll check the numbers first.");
  await atlas("send", "--re", question, "p50 0.3ms, p95 1ms, no refusals in 800 rooms. Ship it.");
  await page.reload();
  await toConversation();
  await page.getByText("p50 0.3ms").first().waitFor({ state: "attached", timeout: 15000 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

  const measure = async (name: string, prepare: () => Promise<unknown>, act: () => Promise<unknown>, after: () => Promise<unknown> = async () => undefined, settleMs?: number) => {
    if (ONLY && !ONLY.includes(name)) return;
    const runs: Run[] = [];
    for (let i = 0; i < REPS; i++) {
      await prepare();
      await page.waitForTimeout(400);
      runs.push(await frames(page, act, settleMs));
      await after();
    }
    const pick = (k: keyof Run) => median(runs.map((r) => r[k]));
    const most = (k: keyof Run) => Math.max(...runs.map((r) => r[k]));
    report[name] = { frames: pick("frames"), over33: pick("over33"), over50: pick("over50"), worstMs: pick("worstMs"), blockingMs: pick("blockingMs"), runs };
    console.log(
      `${name.padEnd(14)} over33 ${pick("over33")} (most ${most("over33")})  over50 ${pick("over50")}  worst ${pick("worstMs")} ms (most ${most("worstMs")})  blocking ${pick("blockingMs")} ms (most ${most("blockingMs")})  ${pick("frames")} frames`,
    );
  };

  const reply = page.getByRole("button", { name: /^1 reply/ }).first();
  const closeThread = page.getByRole("complementary", { name: "Details" }).getByRole("button", { name: "Close", exact: true });
  await measure(
    "thread open",
    async () => undefined,
    () => reply.click(),
    () => closeThread.click(),
  );
  await measure(
    "thread close",
    () => reply.click().then(() => closeThread.waitFor()),
    () => closeThread.click(),
  );

  await toTasks();
  const row = page.getByRole("main").getByRole("button", { name: new RegExp(`^.+ T${ids[1]} · `) });
  const closeTasks = closeThread;
  await row.waitFor();
  await measure(
    "tasks open",
    async () => undefined,
    () => row.click(),
    () => closeTasks.click(),
  );
  await measure(
    "tasks close",
    () => row.click().then(() => closeTasks.waitFor()),
    () => closeTasks.click(),
  );

  let next = 0;
  await measure(
    "board move",
    async () => undefined,
    async () => {
      const id = ids[next++ % ids.length]!;
      await atlas("task", "start", `T${id}`);
      await page.waitForFunction(
        (task) => [...document.querySelectorAll("main .board-row")].find((r) => r.querySelector(".board-meta")?.textContent?.startsWith(`T${task} `))?.classList.contains("is-doing"),
        id,
        { polling: 50, timeout: 15000 },
      );
    },
  );
  const now = page.getByRole("region", { name: "Now" }).getByRole("button", { name: /^Now/ });
  await measure(
    "now fold",
    async () => undefined,
    () => now.click(),
    () => now.click(),
  );

  await toConversation();
  const add = page.getByRole("button", { name: "New channel or join one" });
  await measure(
    "dialog close",
    () => add.click().then(() => page.getByRole("dialog").waitFor()),
    () => page.keyboard.press("Escape"),
    () => page.getByRole("dialog").waitFor({ state: "detached" }),
  );
  if (OUT) writeFileSync(OUT, JSON.stringify({ dist: DIST, cpu: CPU, reps: REPS, report }, null, 2));
} catch (e) {
  const shot = join(tmpdir(), "perf-motion-failed.png");
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await pg.screenshot({ path: shot }).catch(() => undefined);
  console.log(`where it stopped: ${shot}`);
  throw e;
} finally {
  await browser.close();
  for (const p of running) p.kill();
  await stopDaemon(daemonSock(join(cli, "home"))).catch(() => undefined);
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
