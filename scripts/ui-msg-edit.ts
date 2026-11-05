#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { firstRun, letIn, newChannel } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`An agent edits its message in #general three times while jow watches. The message keeps its text on screen through every
edit: an edit that blanked the text for a frame shook the feed's height under its scroll keeper and looped its ResizeObserver
in WebKit (the doc fuzzer's agents edit like this).

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
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
  const sent = await kiwi(["-c", "edits", "--as", "bot", "send", "--to", "#general", "bot line: building"]);
  const seq = /#(\d+)/.exec(sent)?.[1];
  if (!seq) throw new Error(`send said no #seq: ${sent.trim()}`);
  await page.waitForFunction(() => [...document.querySelectorAll(".msg .md")].some((m) => m.textContent?.includes("bot line: building")), undefined, { timeout: 30000 });
  for (let k = 1; k <= EDITS; k++) {
    const text = `bot line: building, step ${k} of ${EDITS}`;
    await kiwi(["-c", "edits", "--as", "bot", "edit", seq, text]);
    await page.waitForFunction((want) => [...document.querySelectorAll(".msg .md")].some((m) => m.textContent?.includes(want)), text, { timeout: 30000 });
  }
  await page.waitForTimeout(300);
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
