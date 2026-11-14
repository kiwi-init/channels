#!/usr/bin/env bun
import type { Page } from "playwright-core";
import { frames, px, rests, topRow, wheelUp } from "./feed-place.ts";
import { engineOf, openStage } from "./feed-stage.ts";

if (process.argv.includes("--help")) {
  console.log(`A room's unread count is the lines that came while you were elsewhere, and reading them clears it.
You sit in #plans and a bot posts 3 lines in #general: its row reads 3. You open #general: the New line is above the first of them, in view,
and the count goes. Scrolled up, 2 more arrive: the view stays, the button reads 2 new messages, and a click on it ends at the bottom with nothing unread.

  bun scripts/ui-harness.ts && bun scripts/ui-feed-unread.ts [--webkit]`);
  process.exit(0);
}

const ENGINE = engineOf(process.argv);
const SEEDS = 30;
const AWAY = 3;
const UP = 2;
const WAIT_MS = 15_000;
const SETTLE_FRAMES = 40;

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

const roomRow = (page: Page, name: string) => page.locator('section[aria-label="Rooms"] .side-row').filter({ hasText: name }).first();

const count = (page: Page, name: string): Promise<string> => roomRow(page, name).evaluate((row) => row.querySelector(".count")?.textContent?.trim() ?? "");

async function reads(page: Page, name: string, want: string): Promise<string> {
  const t0 = Date.now();
  let now = await count(page, name);
  while (now !== want && Date.now() - t0 < WAIT_MS) {
    await page.waitForTimeout(100);
    now = await count(page, name);
  }
  return now;
}

const said = (n: string): string => (n === "" ? "nothing" : n);

const linesAfter = (page: Page, text: string): Promise<string[]> =>
  page.evaluate((text) => {
    const rows = [...document.querySelectorAll<HTMLElement>(".main .feed .feed-list > [data-seq]")];
    const at = rows.findLastIndex((row) => row.querySelector(".msg-text")?.textContent?.trim() === text);
    return rows.slice(at + 1).map((row) => `${row.dataset.seq} "${(row.querySelector(".msg-text")?.textContent ?? row.textContent ?? "").trim().slice(0, 40)}"`);
  }, text);

interface NewLine {
  shown: boolean;
  inView: boolean;
  next: string;
  under: number;
}

const newLine = (page: Page): Promise<NewLine> =>
  page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    const line = feed?.querySelector<HTMLElement>(".feed-new");
    if (!feed || !line) return { shown: false, inView: false, next: "", under: 0 };
    const box = feed.getBoundingClientRect();
    const at = line.getBoundingClientRect();
    const under = [...feed.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")].filter((row) => line.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { shown: true, inView: at.top >= box.top && at.bottom <= box.bottom, next: under[0]?.querySelector(".msg-text")?.textContent?.trim() ?? "", under: under.length };
  });

const stage = await openStage("unread", ENGINE, SEEDS);
try {
  const { page } = stage;
  await page.getByRole("button", { name: "New room" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New room" });
  await dialog.getByRole("textbox").first().fill("plans");
  await dialog.getByRole("button", { name: "Create room" }).click();
  await dialog.waitFor({ state: "detached", timeout: 15_000 });
  await roomRow(page, "plans").click();
  await page.locator('section[aria-label="Rooms"] .side-row.is-on').filter({ hasText: "plans" }).waitFor({ timeout: 15_000 });
  const quiet = await count(page, "general");

  for (let i = 1; i <= AWAY; i++) await stage.bot(`news ${i}`);
  const away = await reads(page, "general", String(AWAY));
  check(quiet === "" && away === String(AWAY), `sitting in #plans, ${AWAY} lines posted in #general show as ${AWAY} on its row (it read ${said(quiet)} before, ${said(away)} after)`);

  await roomRow(page, "general").click();
  await page
    .locator(".main article.msg")
    .filter({ hasText: `news ${AWAY}` })
    .first()
    .waitFor({ timeout: 15_000 });
  await frames(page, SETTLE_FRAMES);
  const line = await newLine(page);
  check(
    line.shown && line.inView && line.next === "news 1" && line.under === AWAY,
    `opening #general puts the New line in view, right above the first unread line, with the ${AWAY} unread under it (${line.shown ? `${line.inView ? "in view" : "out of view"}, above "${line.next}", ${line.under} under it` : "no New line"})`,
  );
  const read = await reads(page, "general", "");
  check(read === "", `reading them clears the count on #general's row (it reads ${said(read)})`);

  const home = await rests(page, (p) => p.pill === "");
  await wheelUp(page, 400);
  const before = await rests(page, () => true, 10_000);
  const reading = await topRow(page, null);
  for (let i = 1; i <= UP; i++) await stage.bot(`later news ${i}`);
  const want = `${UP} new messages`;
  const told = await page
    .waitForFunction((want) => document.querySelector(".main .feed-jump")?.textContent?.includes(want), want, { timeout: WAIT_MS })
    .then(() => true)
    .catch(() => false);
  const after = await rests(page, () => true, 10_000);
  const still = await topRow(page, reading.seq);
  check(
    before.under > 100 && told,
    `scrolled up, with the last line ${px(before.under)} under the view, ${UP} lines arrive and the button reads ${want} (it reads "${after.pill}"; the rows after "news ${AWAY}" are ${(await linesAfter(page, `news ${AWAY}`)).join(", ") || "none"})`,
  );
  check(Math.abs(still.top - reading.top) <= 2, `and the row at the top of the view stays on its pixel (row ${reading.seq} was ${px(reading.top)} from the top, now ${px(still.top)})`);

  await page.locator(".main .feed-jump").click();
  const end = await rests(page, (p) => p.pill === "" && Math.abs(p.under - home.under) <= 2, WAIT_MS);
  const left = await reads(page, "general", "");
  check(
    end.pill === "" && Math.abs(end.under - home.under) <= 2 && left === "",
    `a click on it ends at the bottom with the button gone and nothing unread on #general's row (the last line is ${px(end.under - home.under)} from the bottom line's place, the button reads "${end.pill}", the row reads ${said(left)})`,
  );
  for (const e of stage.threw) check(false, `the page threw: ${e}`);
} finally {
  await stage.close();
}
if (failures.length) {
  console.error(`\nunread counts are wrong, in ${ENGINE}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`\nunread counts are the lines that came while you were away, and reading clears them, in ${ENGINE}`);
