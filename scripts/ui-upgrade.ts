#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";

if (process.argv.includes("--help") || !process.argv.some((a) => a.startsWith("--old="))) {
  console.log(`An older release's data opened by this build. --old is a checkout of the older release with its own harness build
(bun scripts/ui-harness.ts there) and its own scripts/perf-ui.ts, which drives its first run. In one browser profile on one local
relay: the old build signs in, makes a channel, sends --lines lines (60), leaves a draft in the composer and, with the relay down,
a message that fails. Then the relay comes back on the same address serving this build, and the same profile opens it: still
signed in, the channel's messages there from the cache, none missing, and the draft and the failed message still there when
the old release kept them across a restart at all (one that didn't is reported as n/a); a second reload opens the same again (the cache rows this build rewrote), and nothing throws. Chromium only.

--control reopens with the old release's own build instead: what the old release itself keeps across a restart, to read a failure against.

  bun scripts/ui-upgrade.ts --old=/path/to/old/checkout [--control] [--lines=60] [--dist=ui/dist-harness]`);
  process.exit(process.argv.includes("--help") ? 0 : 2);
}

const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OLD = resolve(flag("old")!);
const OLD_DIST = join(OLD, "ui/dist-harness");
const NEW_DIST = process.argv.includes("--control") ? OLD_DIST : harnessDist(flag("dist"));
const LINES = Number(flag("lines") ?? 60);
if (!existsSync(join(OLD_DIST, "index.html"))) throw new Error(`no harness build in ${OLD_DIST}: run bun scripts/ui-harness.ts in ${OLD}`);

interface Driver {
  firstRun(page: Page, name: string): Promise<void>;
  newChannel(page: Page, title: string): Promise<string>;
  say(page: Page, text: string): Promise<void>;
  docOpen(page: Page): Promise<void>;
  composer(page: Page): ReturnType<Page["locator"]>;
}
const old = (await import(join(OLD, "scripts/perf-ui.ts"))) as Driver;

const data = mkdtempSync(join(tmpdir(), "kiwi-upgrade-"));
mkdirSync(join(data, "relay"));
const profile = join(data, "profile");
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
const errors: string[] = [];
const DRAFT = "a draft I never sent, it should still be here";
const FAILED = "this one was sent while the relay was down";
const last = `line ${LINES} of ${LINES}: written by the old release`;

const open = async (): Promise<{ context: BrowserContext; page: Page }> => {
  const context = await chromium.launchPersistentContext(profile, { executablePath: process.env.SMOKE_CHROMIUM || undefined, viewport: { width: 1280, height: 860 } });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("pageerror", (e) => errors.push(e.message));
  return { context, page };
};
const rows = (page: Page): Promise<number> => page.evaluate(() => new Set([...document.querySelectorAll<HTMLElement>(".main .feed-list > [data-seq]")].map((r) => r.dataset.seq)).size);
const shows = (page: Page, text: string, timeout = 30000): Promise<boolean> =>
  page
    .waitForFunction((want) => document.querySelector(".main .feed-list")?.textContent?.includes(want), text, { timeout })
    .then(
      () => true,
      () => false,
    );
const kept = (page: Page): Promise<string> =>
  page.evaluate(() =>
    Object.keys(localStorage)
      .map((k) => `${k}=${(localStorage.getItem(k) ?? "").length}`)
      .join(" "),
  );
const marks = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() =>
    Object.fromEntries(
      performance
        .getEntriesByType("mark")
        .filter((m) => m.name.startsWith("kiwi:"))
        .map((m) => [m.name.slice(5), Math.round(m.startTime)]),
    ),
  );

let relay = await startLocalRelay(join(data, "relay"), OLD_DIST, { rateLimits: false });
const port = relay.port;
const BASE = `http://127.0.0.1:${port}/`;
try {
  let { context, page } = await open();
  await page.goto(BASE);
  await old.firstRun(page, "jow");
  await old.newChannel(page, "kept");
  await old.docOpen(page);
  for (let n = 1; n <= LINES; n++) await old.say(page, `line ${n} of ${LINES}: written by the old release`);
  expect(await shows(page, last, 120000), `the old release sent ${LINES} lines`);
  await page.waitForTimeout(8000);
  const before = await rows(page);
  relay.relay.kill();
  await page.waitForTimeout(1500);
  await old.say(page, FAILED);
  const failed = await page
    .locator("article.msg.is-failed, .msg-failed")
    .first()
    .waitFor({ timeout: 90000 })
    .then(
      () => true,
      () => false,
    );
  expect(failed, "with the relay down, the old release marks a message as not sent");
  await old.composer(page).fill(DRAFT);
  await page.waitForTimeout(2500);
  const left = await kept(page);
  console.log(`local storage as the old release leaves it: ${left}`);
  const keepsDrafts = left.includes("kiwi:drafts=");
  const keepsUnsent = left.includes("kiwi:unsent=");
  const control = process.argv.includes("--control");
  const skipped = (what: string, why: string) => console.log(`n/a  ${what}: ${why}`);
  await context.close();

  relay = await startLocalRelay(join(data, "relay"), NEW_DIST, { rateLimits: false, port });
  ({ context, page } = await open());
  await page.goto(BASE);
  const back = await shows(page, last, 30000);
  expect(back, "this build opens the old release's channel with its last line there");
  console.log(`local storage as this build finds it: ${await kept(page)}`);
  const first = await marks(page);
  console.log(`marks on the first open: ${JSON.stringify(first)}`);
  expect((await page.locator("dialog.onb, .onb").count()) === 0, "still signed in: no onboarding, no sign-in screen");
  if (control) skipped("the cache marks", "the old release's own build is not asked for this build's marks");
  else expect(first["cache-open"] !== undefined && first["first-message"] !== undefined, "the old cache opened and painted (no blank first open)");
  await page.waitForTimeout(6000);
  const after = await rows(page);
  expect(after >= before, `no message is missing (${before} rows before, ${after} now)`);
  if (keepsUnsent) expect(await shows(page, FAILED, 5000), "the message that failed is still there: marked not sent, or sent by itself now the relay is back");
  else skipped("the message that failed", "the old release kept no unsent messages across a restart");
  if (keepsDrafts)
    expect(
      (await old
        .composer(page)
        .inputValue()
        .catch(() => "")) === DRAFT,
      "the draft is still in the composer",
    );
  else skipped("the draft", "the old release kept no drafts across a restart");

  await page.reload();
  expect(await shows(page, last, 30000), "a second open, from the cache rows this build rewrote, shows the same");
  const second = await marks(page);
  console.log(`marks on the second open: ${JSON.stringify(second)}`);
  await page.waitForTimeout(4000);
  expect((await rows(page)) >= before, "and still no message missing");
  expect(errors.length === 0, `nothing threw${errors.length ? `: ${errors.slice(0, 3).join("; ")}` : ""}`);
  await context.close();
} finally {
  relay.relay.kill();
  rmSync(data, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nthe older release's data opens in this build");
