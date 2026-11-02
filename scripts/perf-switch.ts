// How long switching channels takes: two channels with PERF_MESSAGES messages each (400 by default),
// a click on the other channel's tile in the rail, timed until its first screen, #general with its last message, is painted.
// At 1x and with the CPU throttled 4x, a channel's first visit and its later ones, plus a profile of
// the slowest. With PERF_BUDGET_MS set it fails when the median revisit at 4x is over it.
//
//   bun scripts/ui-harness.ts && bun scripts/perf-switch.ts [--json out.json]
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { firstRun, letIn, newChannel } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

const ROOT = resolve(import.meta.dir, "..");
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 400);
const BUDGET = process.env.PERF_BUDGET_MS ? Number(process.env.PERF_BUDGET_MS) : null;
const jsonAt = process.argv.indexOf("--json");
const OUT = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;
const data = mkdtempSync(join(tmpdir(), "kiwi-perf-switch-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const running: ChildProcess[] = [];
function kiwi(home: string, argv: string[]): Promise<string> {
  const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, home), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
  const p = spawn("bun", ["src/cli/main.ts", ...argv], { cwd: ROOT, env });
  running.push(p);
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${argv.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`)))));
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const { relay, port } = await startLocalRelay(join(data, "relay"), harnessDist());
const BASE = `http://localhost:${port}/`;

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

async function channel(page: Page, title: string): Promise<string> {
  const code = await newChannel(page, title);
  let joined = false;
  const joining = kiwi(title, ["join", code, title, "--as", "atlas", "--model", "claude-opus-5-5", "--relay", BASE]).then(() => void (joined = true));
  await letIn(page, () => !joined).catch(async (e: unknown) => {
    await page.screenshot({ path: join(tmpdir(), `kiwi-perf-switch-${title}.png`) });
    throw e;
  });
  await joining;
  await page.getByRole("textbox", { name: "Message" }).fill(`Plan the ${title} board`);
  await page.keyboard.press("Enter");
  return code;
}

async function seed(alias: string, prefix: string): Promise<void> {
  const texts = [
    "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```",
    "On it. I'll have win run the steady load first, then the cold runs.",
    "Merged #398. The rails are darker and the page is a round sheet beside them, in light and dark.",
  ];
  const send = async (text: string): Promise<void> => {
    for (;;) {
      try {
        await kiwi(alias, ["-c", alias, "--as", "atlas", "send", text]);
        return;
      } catch (e) {
        if (!String(e).includes("too many")) throw e;
        await new Promise((r) => setTimeout(r, 15000));
      }
    }
  };
  let ask = "";
  while (!ask) {
    const said = (await kiwi(alias, ["-c", alias, "--as", "atlas", "log", "-n", "20", "--json"]))
      .split("\n")
      .flatMap((line) => (line.trim() ? [JSON.parse(line) as { seq: number; body?: string }] : []));
    ask = String(said.find((m) => m.body?.startsWith("Plan the "))?.seq ?? "");
    if (!ask) await new Promise((r) => setTimeout(r, 300));
  }
  await kiwi(alias, ["-c", alias, "--as", "atlas", "spec", "write", ask, `# ${prefix} board\n\n## Done when\n- [ ] the first screen of ${alias} shows`]);
  for (let i = 0; i < MESSAGES; i += 10) await Promise.all(Array.from({ length: Math.min(10, MESSAGES - i) }, (_, j) => send(`${prefix}${i + j}: ${texts[(i + j) % texts.length]}`)));
}

// A click on the channel's tile in the rail, timed in the page until the target's first screen (its last message) is painted.
async function switchTo(page: Page, title: string, last: string): Promise<number> {
  return page.evaluate(
    async ([name, text]) => {
      const tile = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === name);
      if (!tile) throw new Error(`no ${name} tile in the rail`);
      const t0 = performance.now();
      tile.click();
      const deadline = t0 + 15000;
      while (performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        if (document.body.innerText.includes(text)) break;
      }
      if (performance.now() >= deadline) throw new Error(`${name} opened without “${text}”`);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    },
    [title, last] as const,
  );
}

async function profile(cdp: CDPSession, run: () => Promise<unknown>): Promise<string[]> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await run();
  const { profile: prof } = (await cdp.send("Profiler.stop")) as {
    profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples: number[]; timeDeltas: number[] };
  };
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  prof.samples.forEach((id, i) => {
    const n = byId.get(id)!;
    const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.replace(/^.*\//, "")}:${n.callFrame.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (prof.timeDeltas[i] ?? 0));
  });
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => `${(v / 1000).toFixed(1)}ms  ${k}`);
}

const report: Record<string, unknown> = { messages: MESSAGES };
let failed = false;
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await page.goto(BASE);
  await firstRun(page, "Jonatas");

  const t0 = Date.now();
  await channel(page, "alpha");
  await channel(page, "beta");
  await Promise.all([seed("alpha", "A"), seed("beta", "B")]);
  console.log(`seeded ${MESSAGES} messages in each of two channels in ${Math.round((Date.now() - t0) / 1000)}s`);

  const lastOf = { alpha: `A${MESSAGES - 1}: `, beta: `B${MESSAGES - 1}: ` };
  await page
    .getByText(`B${MESSAGES - 1}: `)
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 60000 });
  await switchTo(page, "alpha", lastOf.alpha);

  for (const throttle of [1, 4]) {
    const cdp = await page.context().newCDPSession(page);
    await switchTo(page, "alpha", lastOf.alpha);
    await page.reload();
    await page.getByText(lastOf.alpha).filter({ visible: true }).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    const first = await switchTo(page, "beta", lastOf.beta);
    await page.waitForTimeout(800);
    const again: number[] = [];
    for (let i = 0; i < 6; i++) {
      const to = i % 2 === 0 ? "alpha" : "beta";
      again.push(await switchTo(page, to, lastOf[to]));
      await page.waitForTimeout(800);
    }
    const key = `@${throttle}x`;
    report[key] = { firstVisitMs: first, revisitsMs: again, revisitMedianMs: median(again) };
    console.log(key, JSON.stringify(report[key]));
    if (throttle === 4) {
      report["profile: revisit @4x"] = await profile(cdp, () => switchTo(page, "alpha", lastOf.alpha));
      await page.waitForTimeout(800);
      if (BUDGET !== null && median(again) > BUDGET) {
        failed = true;
        console.log(`over budget: the median revisit at 4x is ${median(again)}ms, the budget ${BUDGET}ms`);
      }
    }
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.detach();
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  for (const p of running) p.kill();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failed) process.exit(1);
