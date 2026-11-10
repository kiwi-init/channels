#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { docOpen, firstRun, letIn, newChannel, say } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`Three agents answer one message sent to everyone, in the app. The owner asks in #general from the app; ann, bob and
carl each run kiwi reply. The first is the answer; the other two are told theirs went under it, none is refused, and the app
shows the message with its replies in one thread. --shot writes a picture of the feed with the thread open.

  bun scripts/ui-replies-under.ts [--shot=replies.png] [--dist=ui/dist-harness]

Needs bun scripts/ui-harness.ts first.`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = harnessDist(flag("dist"));
const SHOT = flag("shot");
const AGENTS = ["ann", "bob", "carl"];

const data = mkdtempSync(join(tmpdir(), "kiwi-replies-under-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const name of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", name), 0o755);
}
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const kiwi = (args: string[]): Promise<{ code: number | null; out: string }> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((done) => p.on("exit", (code) => done({ code, out: out.trim() })));
};

const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((err: unknown) => {
  relay.kill();
  throw err;
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "team");
  let joined = 0;
  const joining = Promise.all(AGENTS.map((agent) => kiwi(["join", code, "team", "--relay", BASE, "--as", agent]).then(() => void joined++)));
  await letIn(page, () => joined < AGENTS.length);
  await joining;
  await docOpen(page);
  const QUESTION = "who can look at the flaky upload test?";
  await say(page, QUESTION);
  const sent = await page.waitForFunction(
    (q) => {
      const row = [...document.querySelectorAll<HTMLElement>("article.msg")].find((m) => m.textContent?.includes(q));
      const at = Number(row?.dataset.seq);
      return Number.isSafeInteger(at) && at > 0 ? at : null;
    },
    QUESTION,
    { timeout: 30000 },
  );
  const seq = Number(await sent.jsonValue());
  const asked = page.locator(`article.msg[data-seq="${seq}"]`);
  expect(Number.isSafeInteger(seq) && seq > 0, `the owner's question is in the feed as #${seq}`);

  const replies: { agent: string; code: number | null; out: string }[] = [];
  for (const [i, agent] of AGENTS.entries()) {
    const text = ["I can, I wrote that test", "I saw it fail on the retry path too", "CI has three more of those from this week"][i]!;
    replies.push({ agent, ...(await kiwi(["-c", "team", "--as", agent, "reply", String(seq), text])) });
  }
  for (const r of replies) console.log(`${r.agent}: ${r.out.replace(/\n/g, " | ")}`);
  expect(
    replies.every((r) => r.code === 0 && /sent #\d+/.test(r.out)),
    "all three replies were sent, none refused",
  );
  expect(!replies[0]!.out.includes("went under"), "the first reply is the answer");
  expect(
    replies.slice(1).every((r) => /ann answered #\d+ first \(#\d+\): yours went under that answer/.test(r.out)),
    "the other two are told theirs went under ann's answer",
  );

  const count = asked.locator(".msg-thread-n");
  await page
    .waitForFunction((q) => /3/.test([...document.querySelectorAll("article.msg")].find((m) => m.textContent?.includes(q))?.querySelector(".msg-thread-n")?.textContent ?? ""), QUESTION, {
      timeout: 30000,
    })
    .catch(() => undefined);
  const shown = (await count.textContent().catch(() => null)) ?? "";
  expect(/3/.test(shown), `the question shows its three replies ("${shown.trim()}")`);
  await asked.locator(".msg-thread").click();
  const panel = page.locator(".panel, [class*='thread']").filter({ hasText: "CI has three more of those from this week" }).first();
  await panel.waitFor({ timeout: 15000 }).catch(() => undefined);
  const inThread = await page.evaluate(
    (lines) => lines.map((line) => document.body.textContent?.includes(line) ?? false),
    ["I can, I wrote that test", "I saw it fail on the retry path too", "CI has three more of those from this week"],
  );
  expect(inThread.every(Boolean), "with the thread open, all three replies are on screen");
  await page.waitForTimeout(800);
  if (SHOT) await page.screenshot({ path: SHOT });
  expect(errors.length === 0, `nothing threw${errors.length ? `: ${errors.slice(0, 3).join("; ")}` : ""}`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthree agents answered one message: one answer, two under it, none dropped");
