#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type BrowserContext, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { channelSettings, composer, docOpen, firstRun, letIn, newChannel, passOnboarding } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`The moved actions and words, used cold. Each case opens a fresh browser context, so no chunk is cached. It holds the chunk that carries the moved actions, the lazy chunks those actions already called on main and the suggestions list until --delay ms after the action. It checks the visible result, page errors, raw i18n keys, the composer's draft and focus, and whether the rail and main column move, sampled every frame. Run it on main's build too to compare timings.

  bun scripts/ui-cold-actions.ts [--dist ui/dist-harness] [--browser chromium|webkit] [--delay 1500] [--record timings.json] [--shots dir]`);
  process.exit(0);
}
const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(flag("--dist"));
const ENGINE = flag("--browser") ?? "chromium";
if (ENGINE !== "webkit" && ENGINE !== "chromium") throw new Error(`--browser is webkit or chromium, not ${ENGINE}`);
const DELAY = Number(flag("--delay") ?? 1500);
const RECORD = flag("--record");
const SHOTS = flag("--shots");

const html = readFileSync(join(DIST, "index.html"), "utf8");
const firstFiles = new Set([...html.matchAll(/<script type="module"[^>]*src="\/([^"]+)"|<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(([, a, b]) => `/${a ?? b ?? ""}`));
const HELD = /^\/assets\/(actions-later|manage|rare|suggestions)-[^/]+\.js$/;
const held = (url: URL) => HELD.test(url.pathname) && !firstFiles.has(url.pathname);
const LATER_ACTIONS = /\/assets\/actions-later-[^/]+\.js$/;

const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
const timings: Record<string, number | null> = {};

const data = mkdtempSync(join(tmpdir(), "kiwi-cold-actions-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
writeFileSync(join(cli, "bin", "open"), "#!/bin/sh\nexit 0\n");
writeFileSync(join(cli, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n");
chmodSync(join(cli, "bin", "open"), 0o755);
chmodSync(join(cli, "bin", "xdg-open"), 0o755);
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const running: ChildProcess[] = [];
function kiwi(args: string[]): Promise<string> {
  const proc = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  running.push(proc);
  let out = "";
  proc.stdout.on("data", (d: Buffer) => void (out += d.toString("utf8")));
  proc.stderr.on("data", (d: Buffer) => void (out += d.toString("utf8")));
  return new Promise((ok, fail) => proc.on("exit", (code) => (code === 0 || code === null ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim().slice(0, 300)}`)))));
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser: Browser = await (ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })).catch((err: unknown) => {
  relay.kill();
  throw err;
});

interface Cold {
  ctx: BrowserContext;
  page: Page;
  threw: string[];
  laterLoadedAt: () => number | null;
  acted: () => number;
}

async function cold(state?: Awaited<ReturnType<BrowserContext["storageState"]>>): Promise<Cold> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...(state ? { storageState: state } : {}) });
  let loadedAt: number | null = null;
  let open: () => void = () => {};
  const gate = new Promise<void>((ok) => (open = ok));
  await ctx.route(
    (url) => held(url),
    async (route) => {
      await gate;
      await route.continue();
    },
  );
  const page = await ctx.newPage();
  page.on("requestfinished", (req) => {
    if (loadedAt === null && LATER_ACTIONS.test(new URL(req.url()).pathname)) loadedAt = Date.now();
  });
  const threw: string[] = [];
  await pageErrors(page, (e) => threw.push(e));
  const acted = () => {
    setTimeout(open, DELAY);
    return Date.now();
  };
  return { ctx, page, threw, laterLoadedAt: () => loadedAt, acted };
}

interface Frames {
  keys: string[];
  shift: number;
  frames: number;
}

async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { coldFrames: Frames };
    w.coldFrames = { keys: [], shift: 0, frames: 0 };
    const RAW = /\b(live|chat|shell|usage|settings|modals|status)\.[a-z]+\.[a-z.]+\b/g;
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    const first = [".rail", ".main"].map((sel) => [sel, rect(sel)] as const);
    const tick = () => {
      w.coldFrames.frames++;
      for (const m of document.body.innerText.match(RAW) ?? []) if (!w.coldFrames.keys.includes(m)) w.coldFrames.keys.push(m);
      for (const [sel, was] of first) {
        const now = rect(sel);
        if (was && now) w.coldFrames.shift = Math.max(w.coldFrames.shift, Math.abs(now.x - was.x), Math.abs(now.y - was.y), Math.abs(now.width - was.width));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const frames = (page: Page): Promise<Frames> => page.evaluate(() => (window as unknown as { coldFrames: Frames }).coldFrames);

async function settled(c: Cold, what: string, actedAt: number, needsLater: boolean): Promise<void> {
  const f = await frames(c.page);
  const loaded = c.laterLoadedAt();
  if (needsLater)
    expect(
      loaded === null || loaded > actedAt,
      `${what}: taken before the later actions chunk arrived${loaded === null ? " (main's build has no such chunk)" : ` (it arrived ${loaded - actedAt} ms after)`}`,
    );
  expect(f.keys.length === 0, `${what}: no raw i18n key showed in ${f.frames} frames${f.keys.length ? ` (${f.keys.join(", ")})` : ""}`);
  expect(f.shift < 1, `${what}: the rail and main column didn't move (${f.shift.toFixed(1)} px)`);
  expect(c.threw.length === 0, `${what}: the page never threw${c.threw.length ? ` (${c.threw.join("; ")})` : ""}`);
}

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${ENGINE}-${name}.png`) });
};

const visible = (page: Page, selector: string, ms = 20_000) =>
  page
    .locator(selector)
    .first()
    .waitFor({ timeout: ms })
    .then(
      () => true,
      () => false,
    );

try {
  const prep = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const owner = await prep.newPage();
  await owner.goto(BASE);
  await firstRun(owner, "jow");
  const code = await newChannel(owner, "cold");
  let joined = false;
  const joining = kiwi(["join", code, "cold", "--relay", BASE, "--as", "bot"]).then(() => void (joined = true));
  await letIn(owner, () => !joined);
  await joining;
  await owner.waitForTimeout(1000);
  const state = await prep.storageState({ indexedDB: true });
  await prep.close();

  {
    const c = await cold(state);
    await c.page.goto(BASE);
    await docOpen(c.page);
    await watchFrames(c.page);
    await c.page.getByRole("button", { name: "New room" }).first().click();
    const dialog = c.page.getByRole("dialog", { name: "New room" });
    await dialog.getByRole("textbox").first().fill("plans");
    const actedAt = c.acted();
    await dialog.getByRole("button", { name: "Create room" }).click();
    const shown = await visible(c.page, '.side-row:has-text("plans")');
    timings["new room: click to sidebar row"] = shown ? Date.now() - actedAt : null;
    expect(shown, `a new room made cold shows in the sidebar (${timings["new room: click to sidebar row"]} ms)`);
    await shot(c.page, "new-room");
    await settled(c, "a new room made cold", actedAt, true);
    await c.ctx.close();
  }

  {
    const c = await cold(state);
    await c.page.goto(BASE);
    await docOpen(c.page);
    await watchFrames(c.page);
    const draft = composer(c.page);
    await draft.fill("a draft that stays");
    await channelSettings(c.page, true);
    const dialog = c.page.locator('dialog.modal[open][aria-label="Channel settings"]');
    await dialog
      .getByRole("button", { name: /rename/i })
      .first()
      .click();
    const field = dialog.getByRole("textbox").first();
    await field.fill("colder");
    const focused = await field.evaluate((el) => el === document.activeElement);
    const actedAt = c.acted();
    await field.press("Enter");
    const shown = await visible(c.page, 'header :text("colder"), .main :text("colder")');
    timings["rename: Enter to new name in the header"] = shown ? Date.now() - actedAt : null;
    expect(shown, `a channel renamed cold shows its new name (${timings["rename: Enter to new name in the header"]} ms)`);
    expect(focused, "a channel renamed cold: the name field had focus when Enter was pressed");
    await shot(c.page, "rename");
    await channelSettings(c.page, false);
    expect((await draft.inputValue()) === "a draft that stays", "a channel renamed cold: the composer kept its draft");
    await settled(c, "a channel renamed cold", actedAt, true);
    await c.ctx.close();
  }

  {
    const c = await cold(state);
    await c.page.goto(BASE);
    await docOpen(c.page);
    await watchFrames(c.page);
    const box = composer(c.page);
    await box.click();
    const actedAt = c.acted();
    await box.pressSequentially("hi @");
    const list = c.page.locator('ul.mentions[role="listbox"]').first();
    const shown = await visible(c.page, 'ul.mentions[role="listbox"]');
    timings["@ to suggestions"] = shown ? Date.now() - actedAt : null;
    const label = shown ? await list.getAttribute("aria-label") : null;
    expect(shown && !!label && !/^chat\./.test(label), `the first @ typed cold lists suggestions under a worded label ("${label}", ${timings["@ to suggestions"]} ms)`);
    expect((await box.inputValue()) === "hi @" && (await box.evaluate((el) => el === document.activeElement)), "the first @ typed cold: the composer kept its text and focus");
    await shot(c.page, "suggest");
    await settled(c, "the first @ typed cold", actedAt, false);
    await c.ctx.close();
  }

  {
    const c = await cold();
    const actedAt = c.acted();
    await c.page.goto(`${BASE}#${code}`);
    await watchFrames(c.page);
    await passOnboarding(c.page);
    const name = c.page.getByRole("textbox", { name: "Your name" });
    if (await name.isVisible()) {
      await name.fill("guest");
      await c.page.getByRole("button", { name: "Continue" }).click();
    }
    const named = await visible(c.page, 'dialog button:has-text("Ask to join")', 30_000);
    timings["invite link: open to Ask to join"] = named ? Date.now() - actedAt : null;
    expect(named, `an invite link opened cold offers Ask to join (${timings["invite link: open to Ask to join"]} ms)`);
    await shot(c.page, "invite");
    await settled(c, "an invite link opened cold", actedAt, false);
    await c.ctx.close();
  }
} finally {
  for (const p of running) p.kill();
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}

for (const [what, ms] of Object.entries(timings)) console.log(`${String(ms ?? "-").padStart(6)} ms  ${what}`);
if (RECORD) writeFileSync(RECORD, JSON.stringify({ engine: ENGINE, delay: DELAY, dist: DIST, timings }, null, 2));
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed`);
  process.exit(1);
}
