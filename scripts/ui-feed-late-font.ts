import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { px, rests, serveDist, topRow, wheelUp } from "./feed-place.ts";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-feed-late-font.ts [--dist ui/dist] [--browser webkit|chromium]\n\nThe text font arrives after the feed is on screen and its lines wrap again. At the bottom the last line is still at the bottom of the view; scrolled up, the row at the top of the view is still on its pixel.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const FONT = "lato";
const UP = 1500;

const server = serveDist(dist);
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const font = (page: Page): Promise<{ loaded: boolean; family: string }> =>
  page.evaluate(() => {
    const text = document.querySelector<HTMLElement>(".main .feed .msg-text") ?? document.body;
    return { loaded: [...document.fonts].some((face) => face.family.includes("Lato") && face.status === "loaded"), family: getComputedStyle(text).fontFamily.split(",")[0]?.trim() ?? "" };
  });

try {
  for (const mode of ["at the bottom", "scrolled up"] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pageErrors(page, (e) => fails.push(`page threw ${mode}: ${e}`));
    let arrive: () => void = () => {};
    const held = new Promise<void>((go) => {
      arrive = go;
    });
    await page.route("**/fonts/Lato-*.woff2", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.port}/?shot=long-feed`);
    await page.waitForSelector(".main .feed-list > [data-seq]", { timeout: 15_000 });
    await page.evaluate((name) => document.documentElement.setAttribute("data-font", name), FONT);
    const opened = await rests(page, (p) => p.pill === "");
    if (mode === "scrolled up") await wheelUp(page, UP);
    const before = await rests(page, () => true, 10_000);
    const read = await topRow(page, null);
    const early = await font(page);
    expect(
      !early.loaded && early.family.includes("Lato") && (mode === "at the bottom" ? Math.abs(before.under - opened.under) <= 2 : before.under > 300),
      `${mode}: the feed is on screen in ${early.family} while that font is still on its way (row ${read.seq} at the top, the last line ends ${px(before.under)} under the view)`,
    );
    arrive();
    const came = await page
      .waitForFunction(() => [...document.fonts].some((face) => face.family.includes("Lato") && face.status === "loaded"), undefined, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.evaluate(() => document.fonts.ready);
    const after = await rests(page, () => true, 10_000);
    const now = await topRow(page, read.seq);
    expect(came && Math.abs(after.height - before.height) > 4, `${mode}: the font arrives and the feed's lines wrap again (its rows are ${px(after.height - before.height)} taller)`);
    if (mode === "at the bottom")
      expect(
        Math.abs(after.under - before.under) <= 2 && after.pill === "",
        `at the bottom: a late font leaves the last line at the bottom of the view (${px(after.under - before.under)} from where it was)`,
      );
    else
      expect(Math.abs(now.top - read.top) <= 2, `scrolled up: a late font leaves the row at the top of the view on its pixel (row ${read.seq} was ${px(read.top)} from the top, now ${px(now.top)})`);
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}: a late font moved the conversation`);
  process.exit(1);
}
console.log(`\na late font leaves the conversation where it was, in ${engine}`);
