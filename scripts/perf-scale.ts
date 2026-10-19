import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type CDPSession, type Page } from "playwright-core";
import { daemonSock } from "../src/daemon/protocol.ts";
import { stopDaemon } from "../src/daemon/rpc.ts";

if (process.argv.includes("--help")) {
  console.log(`A busy channel, measured: PERF_AGENTS agents (10), PERF_TASKS tasks (100), PERF_MESSAGES messages (2000), then PERF_SOAK_MIN minutes (20) of agents posting.
Reports cold load, the reload to the first screen, each view's switch at 1x and 4x CPU, key delay while agents post, and heap, DOM nodes and listeners over time.
PERF_TASKS_FIRST=1 makes the tasks before the messages, so a reload has to keep them from beyond the newest 2000.

  bun run web:build && bun scripts/perf-scale.ts [--json out.json]

Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium (or SMOKE_CHROMIUM=<Chrome binary>).`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const AGENTS = Number(process.env.PERF_AGENTS ?? 10);
const TASKS = Number(process.env.PERF_TASKS ?? 100);
const MESSAGES = Number(process.env.PERF_MESSAGES ?? 2000);
const SOAK_MIN = Number(process.env.PERF_SOAK_MIN ?? 20);
const jsonAt = process.argv.indexOf("--json");
const OUT = jsonAt > 0 ? process.argv[jsonAt + 1] : undefined;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://localhost:${PORT}/`;
const data = mkdtempSync(join(tmpdir(), "kiwi-perf-scale-"));
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
async function as(agent: string, argv: string[]): Promise<string> {
  for (;;) {
    try {
      return await kiwi(["-c", "scale", "--as", agent, ...argv]);
    } catch (e) {
      if (!String(e).includes("too many")) throw e;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};
const mb = (b: number) => Math.round((b / 1048576) * 10) / 10;
const log = (...xs: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...xs);

const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", String(PORT), "--data", join(data, "relay"), "--web", "web/dist", "--dev-sign-in"], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((ok, fail) => {
  let out = "";
  relay.stdout!.on("data", (d) => {
    out += d;
    if (out.includes("site: not served")) fail(new Error("web/dist is missing: run bun run web:build first"));
    else if (out.includes("site:")) ok();
  });
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)));
});

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

const WATCH = () => {
  const w = window as unknown as { __long: number[]; __events: { name: string; duration: number; delay: number }[] };
  w.__long = [];
  w.__events = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) =>
    l.getEntries().forEach((e) => {
      const t = e as PerformanceEventTiming;
      w.__events.push({ name: t.name, duration: t.duration, delay: t.processingStart - t.startTime });
    }),
  ).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
};

async function sample(cdp: CDPSession): Promise<{ heapMB: number; nodes: number; listeners: number; documents: number; attached: number; rows: number }> {
  await cdp.send("HeapProfiler.collectGarbage");
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const { result } = (await cdp.send("Runtime.evaluate", { expression: `[document.querySelectorAll("*").length, document.querySelectorAll("[id^='m']").length]`, returnByValue: true })) as {
    result: { value: [number, number] };
  };
  return { heapMB: mb(m.JSHeapUsedSize ?? 0), nodes: m.Nodes ?? 0, listeners: m.JSEventListeners ?? 0, documents: m.Documents ?? 0, attached: result.value[0], rows: result.value[1] };
}

async function drain(page: Page): Promise<{ longTasks: number; longMs: number; worstMs: number; events: { name: string; duration: number; delay: number }[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __long: number[]; __events: { name: string; duration: number; delay: number }[] };
    const long = w.__long.splice(0);
    const events = w.__events.splice(0);
    return { longTasks: long.length, longMs: Math.round(long.reduce((a, b) => a + b, 0)), worstMs: Math.round(Math.max(0, ...long)), events };
  });
}

async function tab(page: Page, label: string, marker: string): Promise<number> {
  return page.evaluate(
    async ([name, text]) => {
      const b = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Views of the channel"] button')].find((x) => x.textContent?.trim() === name);
      if (!b) return -1;
      const t0 = performance.now();
      b.click();
      const deadline = t0 + 15000;
      while (performance.now() < deadline) {
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        if (b.getAttribute("aria-current") === "page" && new RegExp(text).test(document.body.innerText)) break;
      }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    },
    [label, marker] as const,
  );
}

async function work(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] };
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  return { task: m.TaskDuration ?? 0, script: m.ScriptDuration ?? 0, style: m.RecalcStyleDuration ?? 0, layout: m.LayoutDuration ?? 0 };
}

async function detailsToggle(page: Page, cdp: CDPSession, open: boolean): Promise<{ ms: number; taskMs: number; scriptMs: number; styleMs: number; layoutMs: number }> {
  const before = await work(cdp);
  const ms = await page.evaluate(async (opening) => {
    const button = opening
      ? [...document.querySelectorAll<HTMLElement>("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Details:") && b.offsetParent !== null)
      : document.querySelector<HTMLElement>('button[aria-label="Close details"]');
    if (!button) return -1;
    const t0 = performance.now();
    button.click();
    const deadline = t0 + 15000;
    while (performance.now() < deadline) {
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      if (!!document.querySelector('aside[aria-label="Details"]') === opening) break;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - t0);
  }, open);
  await page.waitForTimeout(400);
  const after = await work(cdp);
  const d = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000);
  return { ms, taskMs: d("task"), scriptMs: d("script"), styleMs: d("style"), layoutMs: d("layout") };
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
    .slice(0, 12)
    .map(([k, v]) => `${(v / 1000).toFixed(1)}ms  ${k}`);
}

const TEXTS = [
  "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```",
  "On it. I'll have win run the steady load first, then the cold runs.",
  "Merged #398. The rails are darker and the page is a round sheet beside them, in light and dark.",
  "| step | before | after |\n|---|---|---|\n| first paint | 420ms | 180ms |\n| switch | 270ms | 26ms |",
  "PR is up: https://github.com/ojowwalker77/channels/pull/417 — CI green, waiting on review.",
];

const report: Record<string, unknown> = { agents: AGENTS, tasks: TASKS, messages: MESSAGES, soakMinutes: SOAK_MIN };
const agents = Array.from({ length: AGENTS }, (_, i) => `agent${i}`);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(WATCH);
  await context.addInitScript(
    (marker: string) => {
      const w = window as unknown as { __firstScreen?: number };
      const seen = () => {
        if (w.__firstScreen === undefined && document.body?.textContent?.includes(marker)) w.__firstScreen = performance.now();
        return w.__firstScreen !== undefined;
      };
      new MutationObserver((_, obs) => seen() && obs.disconnect()).observe(document, { childList: true, subtree: true, characterData: true });
    },
    `Task ${TASKS - 1}:`,
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => log(`page error: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  let bytes = 0;
  cdp.on("Network.loadingFinished", (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength));

  const t0 = performance.now();
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "Your name" }).waitFor();
  const firstRun = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), loadMs: Math.round(nav.loadEventEnd), fcpMs: Math.round(fcp?.startTime ?? -1) };
  });
  report["cold: first run, empty cache"] = { ...firstRun, readyMs: Math.round(performance.now() - t0), transferredKB: Math.round(bytes / 1024), ...(await drain(page)), events: undefined };
  log("cold first run", JSON.stringify(report["cold: first run, empty cache"]));

  await page.getByRole("textbox", { name: "Your name" }).fill("Jonatas");
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /Jonatas/i })
    .first()
    .waitFor();
  const wa = await context.newCDPSession(page);
  await wa.send("WebAuthn.enable");
  await wa.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  } as never);

  await page.getByRole("complementary").getByRole("button", { name: "New channel", exact: true }).first().click();
  await page.getByRole("dialog").getByRole("textbox").fill("scale");
  const before = page.url();
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.waitForURL((u) => /#mc2-/.test(u.href) && u.href !== before);
  const code = decodeURIComponent(new URL(page.url()).hash.slice(1));
  const needs = page.getByRole("region", { name: "Needs you" });
  const letIn = needs.getByRole("button", { name: "It matches: let in" });
  const showCode = needs.getByRole("button", { name: "Show code" });
  for (const agent of agents) {
    const joining = kiwi(["join", code, "scale", "--as", agent, "--model", "claude-opus-5-5", "--relay", BASE]);
    let joined = false;
    void joining.then(() => (joined = true));
    const deadline = Date.now() + 60000;
    while (!joined && Date.now() < deadline) {
      if (await showCode.isVisible().catch(() => false)) await showCode.click().catch(() => undefined);
      if (await letIn.isVisible().catch(() => false)) await letIn.click().catch(() => undefined);
      await page.waitForTimeout(300);
    }
    await joining;
    const offer = page.getByRole("button", { name: "Save channels to a passkey" });
    if (await offer.isVisible().catch(() => false)) {
      await offer.click();
      const saving = page.getByRole("dialog").filter({ hasText: "Save your recovery code" });
      await saving.waitFor();
      await saving.getByRole("checkbox").check();
      await saving.getByRole("button", { name: "Done" }).click();
      await saving.waitFor({ state: "hidden" });
    }
  }
  log(`${AGENTS} agents in`);
  await drain(page);

  const heap: { atMin: number; phase: string; heapMB: number; nodes: number; listeners: number; documents: number }[] = [];
  const start = Date.now();
  const mark = async (phase: string) => {
    const s = await sample(cdp);
    heap.push({ atMin: Math.round((Date.now() - start) / 6000) / 10, phase, ...s });
    log(phase, JSON.stringify(s));
  };
  await mark("agents in, empty channel");

  const seedStart = Date.now();
  const perSender = Math.ceil(MESSAGES / AGENTS);
  const early = process.env.PERF_TASKS_FIRST ? 0 : Math.floor(perSender * 0.7);
  let sent = 0;
  const tasks: string[] = [];
  const post = (from: number, to: number) =>
    Promise.all(
      agents.map(async (agent, a) => {
        for (let i = from; i < to; i++) {
          const n = a * perSender + i;
          if (n >= MESSAGES) return;
          const dest = n % 4 === 0 && tasks.length ? ["--to", tasks[n % tasks.length]!] : [];
          await as(agent, ["send", ...dest, `M${n}: ${TEXTS[n % TEXTS.length]}`]);
          sent++;
          if (sent % 500 === 0) await mark(`${sent} messages`);
        }
      }),
    );
  await post(0, early);
  const perAgent = Math.ceil(TASKS / AGENTS);
  await Promise.all(
    agents.map(async (agent, a) => {
      for (let i = 0; i < perAgent && a * perAgent + i < TASKS; i++) {
        const n = a * perAgent + i;
        const out = await as(agent, [
          "task",
          "add",
          `Task ${n}: ${["speed up the switch", "fix the relay retry", "polish the sidebar", "write the stable criteria"][n % 4]} (${agent})`,
          "--owner",
          agent,
        ]);
        const id = out.match(/\bT\d+\b/)?.[0];
        if (!id) continue;
        tasks.push(id);
        if (n % 3 === 1) await as(agent, ["task", "start", id]);
        if (n % 3 === 2) await as(agent, ["task", "done", id]);
      }
    }),
  );
  log(`${tasks.length} tasks`);
  await mark("tasks added");

  await post(early, perSender);
  report.seedSeconds = Math.round((Date.now() - seedStart) / 1000);
  const live = await drain(page);
  report["while seeding (page open on the channel)"] = { longTasks: live.longTasks, longMs: live.longMs, worstMs: live.worstMs, perMessageMs: Math.round((live.longMs / MESSAGES) * 10) / 10 };
  log("seeded", JSON.stringify(report["while seeding (page open on the channel)"]));
  await mark(`${MESSAGES} messages, live`);

  const lastTask = `Task ${TASKS - 1}:`;
  for (const throttle of [1, 4]) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const reloadAt = performance.now();
    await page.reload();
    await page
      .getByText(lastTask)
      .filter({ visible: true })
      .first()
      .waitFor({ timeout: 60000 })
      .catch(async (e: unknown) => {
        await page.screenshot({ path: join(tmpdir(), "kiwi-perf-scale-reload.png"), fullPage: true });
        writeFileSync(join(tmpdir(), "kiwi-perf-scale-reload.txt"), await page.evaluate(() => document.body.innerText));
        throw e;
      });
    const reloadMs = Math.round(performance.now() - reloadAt);
    const inPage = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
      return {
        firstScreenMs: Math.round((window as unknown as { __firstScreen?: number }).__firstScreen ?? -1),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        fcpMs: Math.round(performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1),
      };
    });
    if (throttle === 1) report["reload, in page"] = inPage;
    log("reload in page", JSON.stringify(inPage));
    await page.waitForTimeout(2000);
    await drain(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    const views: Record<string, number[]> = { Agents: [], Conversation: [], Tasks: [] };
    const markers: Record<string, string> = { Agents: agents.at(-1)!, Conversation: "M\\d+: ", Tasks: lastTask };
    for (let i = 0; i < 3; i++)
      for (const v of ["Agents", "Conversation", "Tasks"]) {
        views[v]!.push(await tab(page, v, markers[v]!));
        await page.waitForTimeout(500);
      }
    await tab(page, "Conversation", markers.Conversation!);
    await page.waitForTimeout(500);
    const opens: Awaited<ReturnType<typeof detailsToggle>>[] = [];
    const closes: Awaited<ReturnType<typeof detailsToggle>>[] = [];
    for (let i = 0; i < 5; i++) {
      opens.push(await detailsToggle(page, cdp, true));
      closes.push(await detailsToggle(page, cdp, false));
    }
    const mid = (xs: Awaited<ReturnType<typeof detailsToggle>>[]) => ({
      ms: median(xs.map((x) => x.ms)),
      taskMs: median(xs.map((x) => x.taskMs)),
      scriptMs: median(xs.map((x) => x.scriptMs)),
      styleMs: median(xs.map((x) => x.styleMs)),
      layoutMs: median(xs.map((x) => x.layoutMs)),
    });
    report[`details @${throttle}x`] = { open: mid(opens), close: mid(closes) };
    log(`details @${throttle}x`, JSON.stringify(report[`details @${throttle}x`]));
    const after = await drain(page);
    report[`@${throttle}x`] = {
      reloadToTasksMs: throttle === 1 ? reloadMs : undefined,
      switchMedianMs: Object.fromEntries(Object.entries(views).map(([k, v]) => [k, median(v)])),
      switchMs: views,
      longTasks: after.longTasks,
      worstMs: after.worstMs,
    };
    log(`@${throttle}x`, JSON.stringify(report[`@${throttle}x`]));
    if (throttle === 4) {
      report["profile: Conversation @4x"] = await profile(cdp, () => tab(page, "Conversation", markers.Conversation!));
      await page.waitForTimeout(500);
      report["profile: Tasks @4x"] = await profile(cdp, () => tab(page, "Tasks", markers.Tasks!));
      await page.waitForTimeout(500);
      report["profile: Agents @4x"] = await profile(cdp, () => tab(page, "Agents", markers.Agents!));
    }
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await tab(page, "Conversation", "M\\d+: ");
  const composer = page.getByRole("textbox").last();
  await composer.click();
  await drain(page);
  const typing = (async () => {
    for (let i = 0; i < 3; i++) {
      await composer.pressSequentially("the build is green and the switch is fast now ", { delay: 40 });
      await composer.fill("");
    }
  })();
  const burst = Promise.all(agents.map((agent, a) => as(agent, ["send", `burst ${a}: ${TEXTS[a % TEXTS.length]}`])));
  await Promise.all([typing, burst]);
  const typed = await drain(page);
  const keys = typed.events
    .filter((e) => e.name.startsWith("key"))
    .map((e) => e.duration)
    .sort((a, b) => a - b);
  report[`typing while ${AGENTS} agents post`] = {
    keyEventsOver16ms: keys.length,
    over50ms: keys.filter((d) => d > 50).length,
    p95Ms: Math.round(keys[Math.floor(keys.length * 0.95)] ?? 0),
    worstMs: Math.round(keys.at(-1) ?? 0),
    longTasks: typed.longTasks,
    worstLongMs: typed.worstMs,
  };
  log("typing", JSON.stringify(report[`typing while ${AGENTS} agents post`]));

  log(`soak: ${SOAK_MIN} minutes`);
  const soakEnd = Date.now() + SOAK_MIN * 60000;
  let soakSent = 0;
  const posting = Promise.all(
    agents.map(async (agent, a) => {
      while (Date.now() < soakEnd) {
        const n = MESSAGES + soakSent++;
        const to = n % 5 === 0 && tasks.length ? ["--to", tasks[n % tasks.length]!] : [];
        await as(agent, ["send", ...to, `S${n}: ${TEXTS[(n + a) % TEXTS.length]}`]);
        await new Promise((r) => setTimeout(r, 4000 + Math.random() * 4000));
      }
    }),
  );
  let minute = 0;
  const idle = { longTasks: 0, longMs: 0, worstMs: 0 };
  while (Date.now() < soakEnd) {
    await page.waitForTimeout(60000);
    minute++;
    const d = await drain(page);
    idle.longTasks += d.longTasks;
    idle.longMs += d.longMs;
    idle.worstMs = Math.max(idle.worstMs, d.worstMs);
    if (process.env.PERF_SOAK_TABS !== "0") for (const v of ["Tasks", "Agents", "Conversation"]) await tab(page, v, "");
    await drain(page);
    await mark(`soak minute ${minute}`);
  }
  await posting;
  const soak = idle;
  const soakHeap = heap.filter((h) => h.phase.startsWith("soak"));
  const first = soakHeap[0];
  const last = soakHeap.at(-1);
  report.soak = {
    messagesSent: soakSent,
    longTasks: soak.longTasks,
    longMs: soak.longMs,
    worstMs: soak.worstMs,
    heapSlopeMBPerHour: first && last && last.atMin > first.atMin ? Math.round(((last.heapMB - first.heapMB) / (last.atMin - first.atMin)) * 60 * 10) / 10 : null,
    nodesSlopePerHour: first && last && last.atMin > first.atMin ? Math.round(((last.nodes - first.nodes) / (last.atMin - first.atMin)) * 60) : null,
    listenersSlopePerHour: first && last && last.atMin > first.atMin ? Math.round(((last.listeners - first.listeners) / (last.atMin - first.atMin)) * 60) : null,
  };
  report.heap = heap;
  log("soak", JSON.stringify(report.soak));
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  else console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  for (const p of running) p.kill();
  await stopDaemon(daemonSock(join(cli, "home")));
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
