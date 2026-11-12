import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-feed-late-font.ts [--dist ui/dist] [--browser webkit|chromium]\n\nThe text font arrives after the feed is on screen and its lines wrap again. At the bottom the feed is still at the bottom; scrolled up, the row at the top of the view is still on its pixel.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const FONT = "lato";
const FACE = '16px "Lato"';
const UP = 1500;
const SETTLE_FRAMES = 40;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

interface Seen {
  below: number;
  height: number;
  seq: number;
  top: number;
  loaded: boolean;
  family: string;
}

const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let left = n;
        const tick = () => (--left > 0 ? void requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

const seen = (page: Page, seq: number | null): Promise<Seen> =>
  page.evaluate(
    ({ seq, face }) => {
      const feed = document.querySelector<HTMLElement>(".main .feed");
      const list = feed?.querySelector<HTMLElement>(".feed-list");
      if (!feed || !list) throw new Error("no feed on screen");
      const edge = feed.getBoundingClientRect().top;
      const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-seq]")];
      const row = seq === null ? rows.find((r) => r.getBoundingClientRect().bottom > edge + 1) : rows.find((r) => Number(r.getAttribute("data-seq")) === seq);
      const text = list.querySelector<HTMLElement>(".msg-text") ?? list;
      return {
        below: feed.scrollHeight - feed.scrollTop - feed.clientHeight,
        height: list.getBoundingClientRect().height,
        seq: row ? Number(row.getAttribute("data-seq")) : -1,
        top: row ? row.getBoundingClientRect().top - edge : Number.NaN,
        loaded: document.fonts.check(face),
        family: getComputedStyle(text).fontFamily.split(",")[0]?.trim() ?? "",
      };
    },
    { seq, face: FACE },
  );

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;

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
    await page.evaluate((font) => document.documentElement.setAttribute("data-font", font), FONT);
    await page.waitForFunction(
      () => {
        const feed = document.querySelector<HTMLElement>(".main .feed");
        return !!feed && feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 2 && !document.querySelector(".main .feed-jump");
      },
      undefined,
      { timeout: 30_000 },
    );
    await frames(page, SETTLE_FRAMES);
    if (mode === "scrolled up") {
      const box = await page.locator(".main .feed").boundingBox();
      if (!box) throw new Error("no feed box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -UP);
      await frames(page, SETTLE_FRAMES);
    }
    const before = await seen(page, null);
    expect(
      !before.loaded && before.family.includes("Lato") && (mode === "at the bottom" ? before.below <= 1 : before.below > 300),
      `${mode}: the feed is on screen in ${before.family} while that font is still on its way (${px(before.below)} above its end, row ${before.seq} at the top)`,
    );
    arrive();
    const came = await page
      .waitForFunction((face) => document.fonts.check(face), FACE, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.evaluate(() => document.fonts.ready);
    await frames(page, SETTLE_FRAMES);
    const after = await seen(page, before.seq);
    expect(came && Math.abs(after.height - before.height) > 4, `${mode}: the font arrives and the feed's lines wrap again (its rows are ${px(after.height - before.height)} taller)`);
    if (mode === "at the bottom") expect(after.below <= 1, `at the bottom: a late font leaves the feed at its end (${px(after.below)} below the view)`);
    else
      expect(
        Math.abs(after.top - before.top) <= 2,
        `scrolled up: a late font leaves the row at the top of the view on its pixel (row ${before.seq} was ${px(before.top)} from the top, now ${Number.isNaN(after.top) ? "gone" : px(after.top)})`,
      );
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
