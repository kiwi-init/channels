#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { px, rests, topRow, wheelUp } from "./feed-place.ts";
import { engineOf, openStage } from "./feed-stage.ts";
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

const spotAbove = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    const row = feed?.querySelector(".msg-image-spot")?.closest<HTMLElement>("[data-seq]");
    return feed && row ? feed.getBoundingClientRect().top - row.getBoundingClientRect().bottom : null;
  });

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

interface Gate {
  holdPictures: () => void;
  letPictures: () => void;
}

const gated = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer;
    let open: Promise<void> = Promise.resolve();
    let go: () => void = () => {};
    const gate: Gate = {
      holdPictures: () => {
        open = new Promise<void>((let_) => {
          go = let_;
        });
      },
      letPictures: () => go(),
    };
    Object.assign(window, gate);
    Blob.prototype.arrayBuffer = function (this: Blob) {
      return this.type.startsWith("image/") ? open.then(() => read.call(this)) : read.call(this);
    };
  });
};

const hold = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Gate).holdPictures());
const arrive = (page: Page): Promise<void> => page.evaluate(() => (window as unknown as Gate).letPictures());

const stage = await openStage("late", ENGINE, SEEDS, gated);
try {
  const { page } = stage;
  const shot = join(stage.dir, "shot.png");
  writeFileSync(shot, Buffer.from(await picture(page), "base64"));
  const spot = page.locator(".main .feed .msg-image-spot");
  const opened = await rests(page, (p) => p.pill === "");

  await hold(page);
  await stage.bot("the first shot", ["--image", shot]);
  await spot.first().waitFor({ timeout: 30_000 });
  const bottom = await rests(page, () => true, 10_000);
  check(
    Math.abs(bottom.under - opened.under) <= 2 && (await spot.count()) === 1,
    `at the bottom: a line with a picture arrives and the view follows it while the picture is still on its way (the last line is ${px(bottom.under - opened.under)} from where the bottom line sat)`,
  );
  await arrive(page);
  const first = await shown(page, 1);
  const grown = await rests(page, () => true, 10_000);
  check(first && grown.height - bottom.height > 20, `at the bottom: the picture arrives and its row grows (${px(grown.height - bottom.height)} taller)`);
  check(
    Math.abs(grown.under - opened.under) <= 2 && grown.pill === "",
    `at the bottom: a late picture leaves the last line at the bottom of the view (${px(grown.under - opened.under)} from where it was)`,
  );

  await hold(page);
  await stage.bot("the second shot", ["--image", shot]);
  await spot.first().waitFor({ timeout: 30_000 });
  for (let i = 0; i < AFTER; i++) {
    await say(page, `later line ${i}`);
    await page.waitForTimeout(70);
  }
  await page
    .locator(".main article.msg")
    .filter({ hasText: `later line ${AFTER - 1}` })
    .first()
    .waitFor({ timeout: 30_000 });
  await rests(page, () => true, 10_000);
  const far = await spotAbove(page);
  if (far === null) throw new Error("the second picture's placeholder is gone before it was let through");
  await wheelUp(page, Math.max(0, far - ABOVE));
  const up = await rests(page, () => true, 10_000);
  const read = await topRow(page, null);
  const above = await spotAbove(page);
  check(
    above !== null && above > 0 && above < 400 && up.under > 100 && read.seq > 0,
    `scrolled up: the picture's row ends ${above === null ? "nowhere" : px(above)} above the view with the picture still on its way, and row ${read.seq} is at the top (the last line ends ${px(up.under)} under the view)`,
  );
  await arrive(page);
  const second = await shown(page, 2);
  const after = await rests(page, () => true, 10_000);
  const now = await topRow(page, read.seq);
  check(second && after.height - up.height > 20, `scrolled up: the picture arrives above the view and its row grows (${px(after.height - up.height)} taller)`);
  check(Math.abs(now.top - read.top) <= 2, `scrolled up: a late picture above the view leaves the row at the top on its pixel (row ${read.seq} was ${px(read.top)} from the top, now ${px(now.top)})`);
  for (const e of stage.threw) check(false, `the page threw: ${e}`);
} finally {
  await stage.close();
}
if (failures.length) {
  console.error(`\na late picture moved the conversation, in ${ENGINE}: ${failures.join("; ")}`);
  process.exit(1);
}
console.log(`\na late picture leaves the conversation where it was, in ${ENGINE}`);
