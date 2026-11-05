#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`An agent edits its message in #general three times, then grows it to six paragraphs, while jow writes in the composer below.
The message keeps its text on screen through every edit, and no ResizeObserver resizes what it watches from inside its own
callback: both looped the feed's scroll keeper in WebKit (the doc fuzzer's agents edit like this, T4255).

  bun scripts/ui-msg-edit.ts [--webkit] [--dist=ui/dist-harness]

Needs bun scripts/ui-harness.ts first.`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const EDITS = 3;

const data = mkdtempSync(join(tmpdir(), "kiwi-msg-edit-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ").slice(0, 60)} exited ${code}: ${out.trim().split("\n").pop()}`)))));
};

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const self: string[] = [];
    (globalThis as unknown as { __self: string[] }).__self = self;
    const Real = window.ResizeObserver;
    const size = (el: Element): string => {
      const s = getComputedStyle(el);
      const side = (a: string, b: string): number =>
        parseFloat(s.getPropertyValue(`padding-${a}`)) +
        parseFloat(s.getPropertyValue(`padding-${b}`)) +
        parseFloat(s.getPropertyValue(`border-${a}-width`)) +
        parseFloat(s.getPropertyValue(`border-${b}-width`));
      const axis = (used: string, laid: number, frame: number): number => (used.endsWith("px") ? parseFloat(used) - (s.boxSizing === "border-box" ? frame : 0) : laid - frame);
      const html = el instanceof HTMLElement ? el : null;
      const w = axis(s.width, html?.offsetWidth ?? 0, side("left", "right"));
      const h = axis(s.height, html?.offsetHeight ?? 0, side("top", "bottom"));
      return `${Math.round(w * 10) / 10}x${Math.round(h * 10) / 10}`;
    };
    window.ResizeObserver = class extends Real {
      constructor(cb: ResizeObserverCallback) {
        super((entries, obs) => {
          const before = entries.map((e) => size(e.target));
          cb(entries, obs);
          entries.forEach((e, i) => {
            const now = size(e.target);
            if (now !== before[i]) self.push(`${e.target.className || e.target.tagName}: ${before[i]} → ${now}`);
          });
        });
      }
    };
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const probe = await context.newPage();
  await probe.route("**/resize-probe", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><body></body>" }));
  await probe.goto(`${BASE}resize-probe`);
  const caught = await probe.evaluate(
    () =>
      new Promise<string[]>((done) => {
        const make = (name: string): HTMLDivElement => {
          const el = document.createElement("div");
          el.className = name;
          el.style.cssText = "position:fixed;top:0;left:0;width:100px;height:20px";
          document.body.append(el);
          return el;
        };
        const scaled = make("probe-scaled");
        const grown = make("probe-grown");
        let first = true;
        const watch = new ResizeObserver(() => {
          if (!first) return;
          first = false;
          scaled.style.transform = "scale(0.97)";
          grown.style.width = "110px";
        });
        watch.observe(scaled);
        watch.observe(grown);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            watch.disconnect();
            scaled.remove();
            grown.remove();
            const self = (globalThis as unknown as { __self: string[] }).__self;
            done(self.splice(0));
          }),
        );
      }),
  );
  check(
    "the resize check sees a box that grows inside its own callback, and not one that only scales",
    caught.some((c) => c.startsWith("probe-grown")) && !caught.some((c) => c.startsWith("probe-scaled")) ? null : `it caught: ${caught.join("; ") || "nothing"}`,
  );
  await probe.close();
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "edits");
  let joined = false;
  const joining = kiwi(["join", code, "edits", "--relay", BASE, "--as", "bot"]).then(() => void (joined = true));
  await letIn(page, () => !joined);
  await joining;
  await page.evaluate(() => {
    const seen = { blanks: [] as string[] };
    (globalThis as unknown as { __edits: typeof seen }).__edits = seen;
    const had = new WeakSet<Element>();
    new MutationObserver(() => {
      for (const md of document.querySelectorAll(".msg .md")) {
        if (md.firstElementChild) had.add(md);
        else if (had.has(md)) seen.blanks.push(md.closest(".msg")?.textContent?.slice(0, 80) ?? "");
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await composer(page).click();
  await page.keyboard.type("jow writes below while the bot edits above");
  const sent = await kiwi(["-c", "edits", "--as", "bot", "send", "--to", "#general", "bot line: building"]);
  const seq = /#(\d+)/.exec(sent)?.[1];
  if (!seq) throw new Error(`send said no #seq: ${sent.trim()}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".msg .md")].some((m) => m.textContent?.includes("bot line: building")), undefined, { timeout: 30000 });
  for (let k = 1; k <= EDITS; k++) {
    const text = `bot line: building, step ${k} of ${EDITS}`;
    await kiwi(["-c", "edits", "--as", "bot", "edit", seq, text]);
    await page.waitForFunction((want) => [...document.querySelectorAll(".msg .md")].some((m) => m.textContent?.includes(want)), text, { timeout: 30000 });
  }
  const long = Array.from({ length: 6 }, (_, i) => `bot line, done: paragraph ${i + 1} of the summary`).join("\n\n");
  await kiwi(["-c", "edits", "--as", "bot", "edit", seq, long]);
  await page.waitForFunction(() => [...document.querySelectorAll(".msg .md")].some((m) => m.textContent?.includes("paragraph 6 of the summary")), undefined, { timeout: 30000 });
  await page.waitForTimeout(500);
  const overflow = (): Promise<number> =>
    page.evaluate(() => {
      const feed = document.querySelector<HTMLElement>(".feed");
      return feed ? feed.scrollHeight - feed.clientHeight : 0;
    });
  await composer(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("a draft taller than the window");
  for (let i = 1; i <= 80 && (await overflow()) < 200; i++) {
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type(`row ${i}`, { delay: 1 });
  }
  await page.waitForTimeout(300);
  for (let i = 0; i < 400 && (await overflow()) > 0; i += 6) {
    for (let k = 0; k < 6; k++) await page.keyboard.press("Backspace");
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(500);
  const own = await page.evaluate(() => (globalThis as unknown as { __self: string[] }).__self.slice(0, 5));
  check("no ResizeObserver resizes what it watches from inside its own callback, as the message grows and a draft shrinks in the composer", own.length ? own.join("; ") : null);
  const blanks = await page.evaluate(() => (globalThis as unknown as { __edits: { blanks: string[] } }).__edits.blanks);
  check(`the message keeps its text through ${EDITS} edits`, blanks.length ? `its text went blank ${blanks.length} time(s), first in "${blanks[0]}"` : null);
  check("no page errors", errors.length ? errors.slice(0, 3).join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`an edited message blanked its text, in ${ENGINE}`);
  process.exitCode = 1;
}
