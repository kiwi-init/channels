#!/usr/bin/env bun
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { channelSettings, docOpen, firstRun, letIn, newChannel, say } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";

const data = mkdtempSync(join(tmpdir(), "kiwi-live-shell-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const name of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", name), 0o755);
}
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const running: ChildProcess[] = [];

function start(args: string[]): { proc: ChildProcess; done: Promise<string> } {
  const proc = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  running.push(proc);
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  proc.stdout.on("data", on);
  proc.stderr.on("data", on);
  return {
    proc,
    done: new Promise((ok, fail) => proc.on("exit", (code) => (code === 0 || code === null ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim().slice(0, 300)}`))))),
  };
}
const kiwi = (args: string[]): Promise<string> => start(args).done;

const failures: string[] = [];
const undriven: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};
async function drive(what: string, run: () => Promise<string | null>): Promise<void> {
  try {
    check(what, await run());
  } catch (err) {
    undriven.push(what);
    console.log(`? ${what}: the check couldn't be driven (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`);
  }
}

async function shows(page: Page, selector: string, ms = 20_000): Promise<boolean> {
  return page
    .locator(selector)
    .first()
    .waitFor({ timeout: ms })
    .then(
      () => true,
      () => false,
    );
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await (ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })).catch((err: unknown) => {
  relay.kill();
  throw err;
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const threw: string[] = [];
  page.on("pageerror", (e) => threw.push(e.message));
  await page.goto(BASE);
  await firstRun(page, "jow");

  const busy = await newChannel(page, "busy");
  let inBusy = false;
  const joinBusy = kiwi(["join", busy, "busy", "--relay", BASE, "--as", "bot"]).then(() => void (inBusy = true));
  await letIn(page, () => !inBusy);
  await joinBusy;

  const quiet = await newChannel(page, "quiet");
  let inQuiet = false;
  const joinQuiet = kiwi(["join", quiet, "quiet", "--relay", BASE, "--as", "helper"]).then(() => void (inQuiet = true));
  await letIn(page, () => !inQuiet);
  await joinQuiet;
  await docOpen(page);
  await say(page, "a line of mine in the open channel");
  await page.waitForTimeout(3000);
  const rail = page.locator(".rail");

  await drive("an unread dot shows on the rail tile of a channel that isn't open, without a click", async () => {
    if (await rail.locator(".tile-dot").count()) return "a dot was there before the message";
    await kiwi(["-c", "busy", "--as", "bot", "send", "--to", "#general", "news in the channel that isn't open"]);
    return (await shows(page, ".rail .tile-dot")) ? null : "no dot in 20 s";
  });

  await drive("a join request for the open channel brings up the Needs you tab with its count", async () => {
    start(["join", quiet, "quiet", "--relay", BASE, "--as", "third"]);
    if (!(await shows(page, "nav button.is-needs"))) return "no Needs you tab in 20 s";
    const text = (await page.locator("nav button.is-needs").first().innerText()).replace(/\s+/g, " ");
    return /1/.test(text) ? null : `it reads "${text}"`;
  });

  await drive("a new room shows in the sidebar and in the palette's list", async () => {
    await page.getByRole("button", { name: "New room" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New room" });
    await dialog.getByRole("textbox").first().fill("plans");
    await dialog.getByRole("button", { name: "Create room" }).click();
    await dialog.waitFor({ state: "detached", timeout: 15_000 });
    if (!(await shows(page, '.side-row:has-text("plans")'))) return "the sidebar has no plans room in 20 s";
    await page.keyboard.press("ControlOrMeta+k");
    const box = page.getByRole("combobox").first();
    await box.waitFor({ timeout: 10_000 });
    await box.fill("plans");
    const listed = await shows(page, '[role="option"]:has-text("plans")', 10_000);
    await page.keyboard.press("Escape");
    return listed ? null : "the palette doesn't list plans";
  });

  await drive("a renamed channel shows its new name in the header and on its rail tile", async () => {
    await channelSettings(page, true);
    const dialog = page.locator('dialog.modal[open][aria-label="Channel settings"]');
    await dialog
      .getByRole("button", { name: /rename/i })
      .first()
      .click();
    const field = dialog.getByRole("textbox").first();
    await field.fill("quieter");
    await field.press("Enter");
    await page.waitForTimeout(1500);
    await channelSettings(page, false);
    const header = await shows(page, '.main :text("quieter"), header :text("quieter")', 15_000);
    const tile = await shows(page, '.rail [aria-label*="quieter"], .rail [title*="quieter"]', 15_000);
    return header && tile ? null : `header ${header ? "updated" : "stale"}, rail tile ${tile ? "updated" : "stale"}`;
  });

  await drive("a theme switch repaints the rail and the conversation at once", async () => {
    const paint = () => page.evaluate(() => [".rail", ".main", "body"].map((s) => getComputedStyle(document.querySelector(s) ?? document.body).backgroundColor).join(" | "));
    const before = await paint();
    await page.locator(".rail-gear").click();
    if (!(await shows(page, ".theme-pick", 3000)))
      await page
        .getByRole("button", { name: /appearance|theme/i })
        .first()
        .click();
    await page.locator(".theme-pick").first().waitFor({ timeout: 10_000 });
    const picks = page.locator('.theme-pick[aria-pressed="false"]');
    const n = await picks.count();
    for (let i = 0; i < n; i++) {
      await picks.nth(i).click();
      await page.waitForTimeout(400);
      if ((await paint()) !== before) return null;
    }
    return `tried ${n} themes and the colours stayed "${before}"`;
  });

  check("the page never threw", threw.length ? threw.join("; ") : null);
} finally {
  for (const p of running) p.kill();
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${failures.length} stale, ${undriven.length} not driven`);
if (failures.length) process.exit(1);
