#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { engineOf, frames, openStage, place, px, wheelUp } from "./feed-stage.ts";
import { say } from "./perf-ui.ts";

if (process.argv.includes("--help")) {
  console.log(`A picture arrives after its line is on screen, and its row grows from the placeholder to the picture.
At the bottom, the feed is still at its end. Scrolled up with the picture's row just above the view, the row at the top of the view is still on its pixel.

  bun scripts/ui-harness.ts && bun scripts/ui-feed-late-image.ts [--webkit]`);
  process.exit(0);
}

const ENGINE = engineOf(process.argv);
const SEEDS = 30;
const AFTER = 34;
const ABOVE = 80;
const SETTLE_FRAMES = 40;

const picture = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 750;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2d context");
    g.fillStyle = "#0c0c0d";
    g.fillRect(0, 0, 1200, 750);
    g.fillStyle = "#8ab4ff";
    for (let i = 0; i < 12; i++) g.fillRect(60 + i * 90, 120 + ((i * 53) % 400), 60, 180);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("no png");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });

interface Reading {
  seq: number;
  top: number;
  spot: number | null;
}

const reading = (page: Page, seq: number | null): Promise<Reading> =>
  page.evaluate((seq) => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    if (!feed) throw new Error("no feed on screen");
    const edge = feed.getBoundingClientRect().top;
    const rows = [...feed.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")];
    const row = seq === null ? rows.find((r) => r.getBoundingClientRect().top >= edge) : rows.find((r) => Number(r.dataset.seq) === seq);
    const spot = feed.querySelector(".msg-image-spot")?.closest<HTMLElement>("[data-seq]");
    return { seq: row ? Number(row.dataset.seq) : -1, top: row ? row.getBoundingClientRect().top - edge : Number.NaN, spot: spot ? edge - spot.getBoundingClientRect().bottom : null };
  }, seq);

const shown = (page: Page, pictures: number): Promise<boolean> =>
  page
    .waitForFunction(
      (pictures) => {
        const feed = document.querySelector(".main .feed");
        const all = [...(feed?.querySelectorAll<HTMLImageElement>(".msg-image img") ?? [])];
        return !!feed && !feed.querySelector(".msg-image-spot") && all.length >= pictures && all.every((img) => img.complete && img.naturalWidth > 0);
      },
      pictures,
      { timeout: 30_000 },
    )
    .then(() => true)
    .catch(() => false);

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

const stage = await openStage("late", ENGINE, SEEDS);
try {
  const { page } = stage;
  const shot = join(stage.dir, "shot.png");
  writeFileSync(shot, Buffer.from(await picture(page), "base64"));
  let arrive: () => void = () => {};
  let gate: Promise<void> = Promise.resolve();
  const hold = (): void => {
    gate = new Promise<void>((go) => {
      arrive = go;
    });
  };
  await page.route("**/blobs/**", async (route) => {
    if (route.request().method() === "GET") await gate;
    await route.continue();
  });
  const spot = page.locator(".main .feed .msg-image-spot").first();

  hold();
  await stage.bot("the first shot", ["--image", shot]);
  await spot.waitFor({ timeout: 30_000 });
  await frames(page, SETTLE_FRAMES);
  const bottom = await place(page);
  check(bottom.below <= 2, `at the bottom: a line with a picture arrives and the view follows it while the picture is still on its way (${px(bottom.below)} below the view)`);
  arrive();
  const first = await shown(page, 1);
  await frames(page, SETTLE_FRAMES);
  const grown = await place(page);
  check(first && grown.height - bottom.height > 20, `at the bottom: the picture arrives and its row grows (${px(grown.height - bottom.height)} taller)`);
  check(grown.below <= 2, `at the bottom: a late picture leaves the feed at its end (${px(grown.below)} below the view)`);

  hold();
  await stage.bot("the second shot", ["--image", shot]);
  await spot.waitFor({ timeout: 30_000 });
  for (let i = 0; i < AFTER; i++) {
    await say(page, `later line ${i}`);
    await page.waitForTimeout(70);
  }
  await page
    .locator(".main article.msg")
    .filter({ hasText: `later line ${AFTER - 1}` })
    .first()
    .waitFor({ timeout: 30_000 });
  await frames(page, SETTLE_FRAMES);
  const gap = (await reading(page, null)).spot;
  if (gap === null) throw new Error("the second picture's placeholder is gone before it was let through");
  await wheelUp(page, Math.max(0, gap - ABOVE));
  await frames(page, SETTLE_FRAMES);
  const read = await reading(page, null);
  const up = await place(page);
  check(
    read.spot !== null && read.spot > 0 && read.spot < 400 && up.below > 100 && read.seq > 0,
    `scrolled up: the picture's row ends ${read.spot === null ? "nowhere" : px(read.spot)} above the view with the picture still on its way, and row ${read.seq} is at the top (${px(up.below)} above the end)`,
  );
  arrive();
  const second = await shown(page, 2);
  await frames(page, SETTLE_FRAMES);
  const after = await reading(page, read.seq);
  const taller = (await place(page)).height - up.height;
  check(second && taller > 20, `scrolled up: the picture arrives above the view and its row grows (${px(taller)} taller)`);
  check(
    Math.abs(after.top - read.top) <= 2,
    `scrolled up: a late picture above the view leaves the row at the top on its pixel (row ${read.seq} was ${px(read.top)} from the top, now ${Number.isNaN(after.top) ? "gone" : px(after.top)})`,
  );
  for (const e of stage.threw) check(false, `the page threw: ${e}`);
} finally {
  await stage.close();
}
if (failures.length) {
  console.error(`\na late picture moved the conversation, in ${ENGINE}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`\na late picture leaves the conversation where it was, in ${ENGINE}`);
