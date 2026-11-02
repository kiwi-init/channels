import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);
const FRAMES = 6;
const FRAME_MS = 100;

async function differing(pngs: string[]): Promise<number> {
  const pixels = async (png: string | undefined): Promise<Uint8ClampedArray> => {
    const img = new Image();
    img.src = `data:image/png;base64,${png ?? ""}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  };
  const [x, y] = await Promise.all([pixels(pngs[0]), pixels(pngs[1])]);
  let n = 0;
  for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) n++;
  return n;
}

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=terminal-mine`);
  const screen = page.locator(".term-screen");
  await screen.locator("canvas").waitFor();
  await page.evaluate(async () => {
    const drawer = document.querySelector(".term");
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect instanceof KeyframeEffect && a.effect.target instanceof Node && drawer?.contains(a.effect.target) && a.effect.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished),
    );
  });
  expect(
    await screen.evaluate((el) => el instanceof HTMLElement && el.isContentEditable && el.querySelector(":scope > canvas") !== null),
    "ghostty-web makes the terminal an editable element around its canvas",
  );
  await screen.evaluate((el) => {
    const bare = el.cloneNode(true);
    el.replaceWith(bare);
    if (bare instanceof HTMLElement) bare.focus();
  });
  expect(await screen.evaluate((el) => document.activeElement === el), "the terminal's element, without ghostty-web's handlers, has focus");
  const box = await screen.boundingBox();
  if (!box) throw new Error("the terminal has no box");
  const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
  let caret = 0;
  let steady = 0;
  for (let i = 0; i < FRAMES; i++) {
    const hidden = (await page.screenshot({ caret: "hide", clip })).toString("base64");
    const shown = (await page.screenshot({ caret: "initial", clip })).toString("base64");
    const again = (await page.screenshot({ caret: "hide", clip })).toString("base64");
    if ((await page.evaluate(differing, [hidden, again])) === 0) {
      steady++;
      caret = Math.max(caret, await page.evaluate(differing, [hidden, shown]));
    }
    await page.waitForTimeout(FRAME_MS);
  }
  expect(steady > 0, `the terminal holds still long enough to look for a caret (${steady} of ${FRAMES} frames)`);
  expect(caret === 0, `the browser draws no caret over the terminal (${caret} pixels where it would be)`);
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
