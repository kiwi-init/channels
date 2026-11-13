import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { px, rests, serveDist } from "./feed-place.ts";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-feed-wheel-up.ts [--dist ui/dist] [--browser webkit|chromium]\n\nA long wheel up a long feed, while older rows load above, and the same wheel back down bring the feed's last line back to the bottom of the view: no load skips rows.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);
const engine = flag("--browser") ?? "webkit";

const DISTANCE = 9000;
const STEP = 40;
const EVERY = 16;

const server = serveDist(dist);
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function wheel(page: Page, dy: number): Promise<void> {
  for (let done = 0; done < DISTANCE; done += STEP) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(EVERY);
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.waitForSelector(".main .feed-list > [data-seq]", { timeout: 15_000 });
  const opened = await rests(page, (p) => p.pill === "" && p.rows > 20);
  const feed = await page.locator(".main .feed").boundingBox();
  if (!feed) throw new Error("no feed box");
  await page.mouse.move(feed.x + feed.width / 2, feed.y + feed.height / 2);
  await wheel(page, -STEP);
  const up = await rests(page, () => true, 10_000);
  expect(
    up.first < opened.first && up.under > DISTANCE / 2,
    `${DISTANCE}px of wheel up in ${STEP}px steps loads older rows above (rows ${up.first} to ${up.last} held, ${opened.first} to ${opened.last} when it opened; the last line ends ${px(up.under)} under the view)`,
  );
  await wheel(page, STEP);
  const back = await rests(page, (p) => p.last === opened.last && Math.abs(p.under - opened.under) <= 2, 10_000);
  expect(
    back.last === opened.last && Math.abs(back.under - opened.under) <= 2,
    `the same wheel back down brings the feed's last line back to the bottom of the view (row ${back.last} of ${opened.last}, ${px(back.under - opened.under)} from where it opened)`,
  );
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}: a wheel up skipped rows as older ones loaded`);
  process.exit(1);
}
console.log(`\na long wheel up skips no rows as older ones load, in ${engine}`);
