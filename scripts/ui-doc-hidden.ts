#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, newChannel, say } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const LINES = ["the first line, alpha", "the second line, beta", "the third line, gamma"];
const LOST = "a line written with the relay away";

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-hidden-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const browser = await (
  ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined, args: ["--disable-features=LocalNetworkAccessChecks"] })
).catch((err: unknown) => {
  relay.kill();
  throw err;
});

const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

const rows = (page: Page, text: string) => page.locator(".main article.msg", { hasText: text });

interface Blocks {
  hidden: number;
  hiddenWithChildren: number;
  shown: { text: string; children: number }[];
}

const blocksOf = (page: Page): Promise<Blocks> =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>(".main .thread-doc section.blk")];
    const hidden = all.filter((b) => b.classList.contains("is-hidden"));
    return {
      hidden: hidden.length,
      hiddenWithChildren: hidden.filter((b) => b.childElementCount > 0 && !b.classList.contains("is-empty")).length,
      shown: all.filter((b) => !b.classList.contains("is-hidden")).map((b) => ({ text: b.textContent ?? "", children: b.childElementCount })),
    };
  });

function fromDisk(path: string): string | null {
  const file = join(DIST, normalize(path === "/" || !path.includes(".") ? "index.html" : path));
  return file.startsWith(DIST) && existsSync(file) && statSync(file).isFile() ? file : null;
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let down = false;
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const file = down && req.method() === "GET" && !url.pathname.startsWith("/v1/") ? fromDisk(decodeURIComponent(url.pathname)) : null;
    if (file) return route.fulfill({ path: file });
    return route.continue();
  });
  const page = await context.newPage();
  const threw: string[] = [];
  await pageErrors(page, (e) => threw.push(e));
  await page.goto(`http://127.0.0.1:${port}/`);
  await firstRun(page, "owner");
  await newChannel(page, "hidden blocks");

  for (const line of LINES) {
    await say(page, line);
    await rows(page, line).first().waitFor({ timeout: 30000 });
  }
  await page.waitForTimeout(1500);
  const sent = await blocksOf(page);
  check("each line that shows in the feed is one hidden block in the doc", sent.hidden >= LINES.length ? null : `${sent.hidden} hidden blocks for ${LINES.length} lines`);
  check("a hidden block that is in the feed is bare: it mounts no head, body or foot", sent.hiddenWithChildren === 0 ? null : `${sent.hiddenWithChildren} still hold elements`);
  check("the doc shows no second copy of a sent line", sent.shown.some((b) => LINES.some((l) => b.text.includes(l))) ? `it shows ${JSON.stringify(sent.shown.map((b) => b.text.slice(0, 40)))}` : null);

  const selected = await page.evaluate(() => {
    const main = document.querySelector(".main");
    const sel = getSelection();
    if (!main || !sel) return "";
    sel.selectAllChildren(main);
    const text = sel.toString();
    sel.removeAllRanges();
    return text;
  });
  for (const line of LINES) {
    const times = selected.split(line).length - 1;
    check(`selecting the whole conversation takes "${line}" once`, times === 1 ? null : `${times} times`);
  }

  down = true;
  relay.kill();
  await new Promise((done) => relay.once("exit", done));
  await say(page, LOST);
  const failed = rows(page, LOST).locator(".msg-failed");
  await failed.first().waitFor({ timeout: 90_000 });
  const whileFailed = await blocksOf(page);
  check("the failed line is in the feed, so its block is bare too", whileFailed.hiddenWithChildren === 0 ? null : `${whileFailed.hiddenWithChildren} hidden blocks still hold elements`);
  await failed.first().getByRole("button", { name: "Back to draft" }).click();
  await rows(page, LOST).first().waitFor({ state: "detached", timeout: 15000 });
  await page.waitForTimeout(1000);
  const back = await blocksOf(page);
  const inDoc = back.shown.find((b) => b.text.includes(LOST));
  const inBox = (await composer(page).inputValue()).includes(LOST);
  console.log(`  the text came back ${inDoc ? `as a block in the doc with ${inDoc.children} parts` : inBox ? "into the composer" : "nowhere"}`);
  check("Back to draft gives the text back, where it can be sent again", inDoc || inBox ? null : `shown blocks: ${JSON.stringify(back.shown.map((b) => b.text.slice(0, 40)))}`);
  check("a block that shows again is a full block, not a bare one", !inDoc || inDoc.children > 0 ? null : "it has no parts");
  const others = await blocksOf(page);
  check(
    "the lines sent before are still hidden and bare",
    others.hidden >= LINES.length && others.hiddenWithChildren === 0 ? null : `${others.hidden} hidden, ${others.hiddenWithChildren} with elements`,
  );
  for (const line of LINES) check(`"${line}" still shows once in the feed`, (await rows(page, line).count()) === 1 ? null : `${await rows(page, line).count()} rows`);
  check("the page never threw", threw.length ? threw.join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\ndoc hidden blocks: ok");
