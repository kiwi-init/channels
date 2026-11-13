#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel, say, switchTo } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`An agent edits its message in #general three times, then grows it to six paragraphs, while jow writes in the composer below.
The message keeps its text on screen through every edit, and no ResizeObserver resizes what it watches from inside its own
callback: both looped the feed's scroll keeper in WebKit (the doc fuzzer's agents edit like this, T4255).

Then jow's own three-row line is edited to a one-row line from one window, while a second window of jow has not loaded the
markdown parser yet and shows the line as plain text. There the bubble was fitted to the old text: the new text is laid out
once, on one row, and its row is not resized from inside a resize observer's callback (T1336).

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
  const ownResizes = (): void => {
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
  };
  await context.addInitScript(ownResizes);
  const page = await context.newPage();
  const errors: string[] = [];
  await pageErrors(page, (e) => errors.push(e));
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

  await say(page, "mine: a first line");
  const first = page.locator("article.msg.is-mine", { hasText: "mine: a first line" });
  await first.waitFor({ timeout: 30000 });
  const words = (word: string, n: number): string => Array.from({ length: n }, (_, i) => `${word}${i + 1}`).join(" ");
  const measured = (at: Page, text: string): Promise<{ text: number; room: number }> =>
    at.evaluate((line) => {
      const row = document.querySelector<HTMLElement>(".main article.msg.is-mine");
      const bubble = row?.querySelector<HTMLElement>(".msg-text");
      const from = bubble?.querySelector<HTMLElement>("p");
      if (!row || !bubble || !from) throw new Error("no own line to measure against");
      const px = (v: string): number => Number.parseFloat(v) || 0;
      const rowStyle = getComputedStyle(row);
      const bubbleStyle = getComputedStyle(bubble);
      const span = document.createElement("span");
      span.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap";
      span.style.font = getComputedStyle(from).font;
      span.textContent = line;
      document.body.append(span);
      const text = span.getBoundingClientRect().width;
      span.remove();
      const cap = Math.min(row.clientWidth - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight), 36 * px(getComputedStyle(document.documentElement).fontSize));
      return { text, room: cap - px(bubbleStyle.paddingLeft) - px(bubbleStyle.paddingRight) };
    }, text);
  const { room } = await measured(page, "");
  let longLine = "";
  for (let n = 8; n < 200 && !longLine; n++) if ((await measured(page, words("long", n))).text >= room * 2.15) longLine = words("long", n);
  await say(page, longLine);
  const mine = page.locator("article.msg.is-mine", { hasText: "long1 long2" });
  await mine.waitFor({ timeout: 30000 });
  let ownSeq = "";
  for (let i = 0; i < 300 && !/^\d+$/.test(ownSeq); i++) {
    ownSeq = (await mine.getAttribute("data-seq")) ?? "";
    if (!/^\d+$/.test(ownSeq)) await page.waitForTimeout(100);
  }

  let release = (): void => {};
  const gate = new Promise<void>((open) => void (release = open));
  const second = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: await context.storageState({ indexedDB: true }) });
  await second.addInitScript(ownResizes);
  await second.route(/\/assets\/md4c-[^/]+\.js$/, async (route) => {
    await gate;
    await route.continue();
  });
  const held = await second.newPage();
  await pageErrors(held, (e) => errors.push(`second window: ${e}`));
  await held.goto(BASE, { waitUntil: "domcontentloaded" });
  await held.locator('nav[aria-label="Channels"] button.tile').first().waitFor({ timeout: 30000 });
  await switchTo(held, "edits");
  interface Line {
    plain: boolean;
    set: number;
    pad: number;
    rows: number;
    text: string;
  }
  const line = (): Promise<Line | null> =>
    held.evaluate((at) => {
      const bubble = document.querySelector<HTMLElement>(`.main article.msg[data-seq="${at}"] .msg-text`);
      if (!bubble) return null;
      const range = document.createRange();
      const tops = new Set<number>();
      const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
      }
      const style = getComputedStyle(bubble);
      return {
        plain: !!bubble.querySelector(".md-plain"),
        set: Number.parseFloat(bubble.style.width) || 0,
        pad: (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0),
        rows: tops.size,
        text: bubble.textContent ?? "",
      };
    }, ownSeq);
  const settled = async (want: (l: Line) => boolean): Promise<Line | null> => {
    let last: Line | null = null;
    for (let i = 0; i < 150; i++) {
      last = await line();
      if (last && want(last)) return last;
      await held.waitForTimeout(100);
    }
    return last;
  };
  const before = await settled((l) => l.plain && l.set > 0 && l.text.includes("long1 long2"));
  const fitted = before ? before.set - before.pad : 0;
  check(
    "a second window of jow, with the markdown parser held back, shows the long line as plain text on three rows, in a bubble fitted to its longest row",
    before?.plain && fitted > 0 && before.rows === 3 && room - fitted >= 90
      ? null
      : `plain ${before?.plain}, fitted width ${Math.round(fitted)} px of ${Math.round(room)} px of room, ${before?.rows} rows`,
  );
  const want = fitted + (room - fitted) / 3;
  let shortLine = "";
  for (let n = 4; n < 300 && !shortLine; n++) if ((await measured(held, words("to", n))).text >= want) shortLine = words("to", n);
  const shortWide = (await measured(held, shortLine)).text;
  await held.evaluate(() => void (globalThis as unknown as { __self: string[] }).__self.splice(0));
  await mine.hover();
  await mine.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByRole("textbox", { name: "Edit message" });
  await editor.fill(shortLine);
  await editor.press("Enter");
  const after = await settled((l) => l.text.includes("to1 to2") && !l.text.includes("long1"));
  await held.waitForTimeout(500);
  const resized = await held.evaluate(() =>
    (globalThis as unknown as { __self: string[] }).__self
      .splice(0)
      .filter((s) => /(^| )msg( |:)/.test(s))
      .slice(0, 3),
  );
  check(
    `the line edited to a shorter text (${Math.round(shortWide)} px, wider than the old fit of ${Math.round(fitted)} px) is laid out once there: no resize observer resizes its row from inside its own callback`,
    resized.length ? resized.join("; ") : null,
  );
  const now = await line();
  check("and it sits on one row", after?.text.includes("to1 to2") && now?.rows === 1 ? null : `${now?.rows} rows, text "${now?.text.slice(0, 40)}"`);
  release();
  const rendered = await settled((l) => !l.plain && l.text.includes("to1 to2"));
  await held.waitForTimeout(300);
  const late = await held.evaluate(() => (globalThis as unknown as { __self: string[] }).__self.filter((s) => /(^| )msg( |:)/.test(s)).slice(0, 3));
  check(
    "when the markdown parser arrives the line is rendered on one row, and still nothing resizes its row from inside a callback",
    rendered && !rendered.plain && rendered.rows === 1 && late.length === 0 ? null : `plain ${rendered?.plain}, ${rendered?.rows} rows${late.length ? `, ${late.join("; ")}` : ""}`,
  );
  check("no page errors", errors.length ? errors.slice(0, 3).join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`an edited message blanked its text or was laid out twice, in ${ENGINE}`);
  process.exitCode = 1;
}
