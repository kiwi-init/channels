import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { px, rests, serveDist } from "./feed-place.ts";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-feed-latest.ts [--dist ui/dist] [--browser webkit|chromium]\n\nScrolled up a long feed, a little or far past the rows it holds, Jump to latest shows, takes a click, brings the feed's last line back to the bottom of the view and goes.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const WHEELS = [1, 6, 30] as const;
const WHEEL = 1200;

const server = serveDist(dist);
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
  await page.waitForSelector(".main .feed-list > [data-seq]", { timeout: 15_000 });
  const opened = await rests(page, (p) => p.pill === "" && p.rows > 20);
  expect(
    opened.pill === "" && opened.rows > 20 && opened.under <= 0.5 && opened.under > -200,
    `the long feed opens on its last line with no Jump to latest (${opened.rows} rows, row ${opened.last} ends ${px(-opened.under)} above the bottom of the view)`,
  );
  const box = await page.locator(".main .feed").boundingBox();
  if (!box) throw new Error("no feed box");
  for (const wheels of WHEELS) {
    const at = `${wheels * WHEEL}px of wheel up`;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < wheels; i++) {
      await page.mouse.wheel(0, -WHEEL);
      await page.waitForTimeout(60);
    }
    const pill = page.locator(".main .feed-jump");
    const shown = await pill
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    const up = await rests(page, () => true, 5_000);
    expect(
      shown && up.pill !== "" && (up.last !== opened.last || up.under > 100),
      `${at}: Jump to latest shows (rows ${up.first} to ${up.last} are held, the last of them ends ${px(up.under)} under the view)`,
    );
    if (!shown) continue;
    const onTop = await pill.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    });
    expect(onTop, `${at}: nothing covers it, a click at its middle lands on it`);
    const spot = await pill.boundingBox();
    if (spot) await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
    const back = await rests(page, (p) => p.pill === "" && p.last === opened.last && Math.abs(p.under - opened.under) <= 2);
    expect(
      back.last === opened.last && Math.abs(back.under - opened.under) <= 2,
      `${at}: a click brings the feed's last line back to the bottom of the view (row ${back.last} of ${opened.last}, ${px(back.under - opened.under)} from where it opened)`,
    );
    expect(back.pill === "" && back.room <= 0.5, `${at}: and Jump to latest goes, with no blank room under the last line (it reads "${back.pill}", ${px(back.room)} of room)`);
  }
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}: Jump to latest left the feed away from its last line`);
  process.exit(1);
}
console.log(`\nJump to latest brings the feed's last line back from anywhere, in ${engine}`);
