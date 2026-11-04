#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { eraseLine, firstRun, letIn, newChannel } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.slice(9) ?? 3);
const TYPED = "Salve mister :)";
const BACKS = 6;
const KEY_MS = 100;
const POST_MS = 700;
const WATCH_MS = 3000;
const SECOND = process.argv.includes("--second-window");
const REMOUNT = process.argv.includes("--remount");
const SLEEPER = process.argv.includes("--sleeper") || process.argv.includes("--sleeper-drop");
const DROP = process.argv.includes("--sleeper-drop");
const TRACE = process.argv.find((a) => a.startsWith("--trace="))?.slice(8);
const sleeper = { asleep: false, held: [] as (() => void)[], drop: [] as (() => void)[] };

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-replay-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[], watch?: (out: string) => void): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => ((out += d.toString("utf8")), watch?.(out));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))));
};

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];
let posting = true;
let posted = 0;

async function poster(): Promise<void> {
  while (posting) {
    const n = ++posted;
    void kiwi(["-c", "replay", "--as", "bot", "send", "--to", "#general", `Agent line ${n}: the build is still running, step ${n} of many.`]).catch((e: unknown) => errors.push(String(e)));
    await Bun.sleep(POST_MS);
  }
}

async function draftLine(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const here = document.querySelector<HTMLElement>(".thread-doc section.blk.is-here");
    const text = (p: Element): string => {
      const copy = p.cloneNode(true) as Element;
      for (const c of copy.querySelectorAll(".doc-caret, .ProseMirror-widget")) c.remove();
      return copy.textContent ?? "";
    };
    if (!here) return null;
    const line = [...here.querySelectorAll("p")].map(text).join("\n");
    return getComputedStyle(here).display === "none" ? `${line} (hidden from the doc)` : line;
  });
}

async function palette(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Meta+k");
  await page.keyboard.type(label);
  await page.locator("dialog.palette").getByText(label, { exact: true }).click({ timeout: 5000 });
  await page.locator("dialog.palette").waitFor({ state: "hidden", timeout: 5000 });
}

async function traced(page: Page): Promise<string> {
  await palette(page, "Copy typing trace");
  await page.waitForTimeout(300);
  return page.evaluate(() => (window as unknown as { copied?: string }).copied ?? "(no trace)");
}

let other: Page | null = null;

async function openOther(page: Page): Promise<Page> {
  const next = await page.context().newPage();
  if (SLEEPER)
    await next.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((m) => (sleeper.asleep ? sleeper.held.push(() => server.send(m)) : server.send(m)));
      server.onMessage((m) => (sleeper.asleep ? sleeper.held.push(() => ws.send(m)) : ws.send(m)));
      sleeper.drop.push(() => void ws.close().catch(() => undefined));
    });
  await next.goto(BASE);
  await next.locator(".thread-doc").first().waitFor({ timeout: 30000 });
  await next.waitForTimeout(1000);
  const views = next.getByRole("navigation", { name: "Views" });
  await views
    .getByRole("button", { name: /^Needs you|^Specs|^Agents/ })
    .first()
    .click();
  await next.waitForTimeout(300);
  await views.getByRole("button", { name: /general/ }).click();
  await next.locator(".thread-doc").first().waitFor({ timeout: 30000 });
  await next.waitForTimeout(500);
  console.log("ok  a second window of the same person went away and back to #general, its doc already synced");
  return next;
}

async function round(page: Page, i: number): Promise<string | null> {
  if (TRACE) for (const p of [page, other]) if (p) await palette(p, "Trace typing for 60 seconds");
  await page.locator(".thread-doc .doc-tail").last().click();
  if (SECOND && !other) {
    other = await openOther(page);
    if (TRACE) await palette(other, "Trace typing for 60 seconds");
  }
  if (SLEEPER) {
    await page.keyboard.type(TYPED.slice(0, 2), { delay: KEY_MS });
    await page.waitForTimeout(800);
    sleeper.asleep = true;
    if (DROP) for (const close of sleeper.drop.splice(0)) close();
    await page.keyboard.type(TYPED.slice(2), { delay: KEY_MS });
  } else await page.keyboard.type(TYPED, { delay: KEY_MS });
  if (REMOUNT) {
    const views = page.getByRole("navigation", { name: "Views" });
    await views
      .getByRole("button", { name: /^Needs you|^Specs|^Agents/ })
      .first()
      .click();
    await page.waitForTimeout(300);
    await views.getByRole("button", { name: /general/ }).click();
    await page.locator(".thread-doc section.blk.is-mine").last().waitFor({ timeout: 10000 });
    await page.locator(".thread-doc section.blk.is-mine p").last().click();
    await page.keyboard.press("End");
  }
  if (process.env.REPLAY_DEBUG) {
    console.log(
      await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".thread-doc section")].map((b) => `${b.className}|${b.dataset.author}|${(b.textContent ?? "").slice(0, 60)}`).join("\n")),
    );
    await page.screenshot({ path: process.env.REPLAY_DEBUG });
  }
  for (let k = 0; k < BACKS; k++) await page.keyboard.press("Backspace", { delay: KEY_MS });
  if (SLEEPER) {
    sleeper.asleep = false;
    for (const send of sleeper.held.splice(0)) send();
  }
  const want = TYPED.slice(0, TYPED.length - BACKS);
  const seen: string[] = [];
  const until = Date.now() + WATCH_MS;
  while (Date.now() < until) {
    const line = await draftLine(page);
    if (line !== null && seen.at(-1) !== line) seen.push(line);
    await page.waitForTimeout(50);
  }
  const last = seen.at(-1) ?? "(no line)";
  const why =
    last === want && seen.every((s) => s.length <= want.length + 1)
      ? null
      : `round ${i}: after ${BACKS} Backspaces the line went ${seen.map((s) => JSON.stringify(s)).join(" → ")}, wanted ${JSON.stringify(want)}`;
  if (TRACE) writeFileSync(`${TRACE}-round${i}.txt`, `${why ?? "pass"}\n\n== window A (types)\n${await traced(page)}\n\n== window B\n${other ? await traced(other) : "(none)"}\n`);
  await eraseLine(page);
  await page.waitForTimeout(300);
  return why;
}

let failed = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem("mc.debug-options", "1");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t: string) => void ((window as unknown as { copied?: string }).copied = t) }, configurable: true });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`page: ${e.message}`));
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "replay");
  let joined = false;
  const joining = kiwi(["join", code, "replay", "--relay", BASE, "--as", "bot"]).then((out) => {
    joined = true;
    return out;
  });
  await letIn(page, () => !joined);
  await joining;
  console.log("ok  the agent is in; it posts into #general every 0.7 s while the person types");
  if (SLEEPER) other = await openOther(page);
  void poster();
  await page.waitForTimeout(2000);
  for (let i = 1; i <= ROUNDS; i++) {
    const why = await round(page, i);
    if (why) failed++;
    console.log(why ? `✗ ${why}` : `✓ round ${i}: "${TYPED}" then ${BACKS} Backspaces stays "${TYPED.slice(0, TYPED.length - BACKS)}" while agent lines arrive`);
  }
} finally {
  posting = false;
  await Bun.sleep(1500);
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
for (const e of errors.slice(0, 5)) console.log(`note: ${e}`);
if (failed) {
  console.error(`${failed} of ${ROUNDS} rounds lost, brought back or hid letters of the line being typed, in ${ENGINE}`);
  process.exitCode = 1;
}
