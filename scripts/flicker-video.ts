import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";

const flag = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at > 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};
const dist = resolve(flag("--dist", "ui/dist"));
const scale = Number(flag("--scale", "1"));
const scroll = flag("--scroll", "bottom");
const focus = flag("--focus", "off");
const windows = Number(flag("--windows", "3"));
const seconds = Number(flag("--seconds", "30"));
const out = resolve(flag("--out", "flicker-out/video"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}`);
const cell = `scale${scale}-${scroll}-focus${focus}`;
mkdirSync(join(out, cell), { recursive: true });

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const viewport = { width: Math.round(1421 / scale), height: Math.round(1298 / scale) };
const browser = await webkit.launch();
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, recordVideo: { dir: join(out, cell), size: viewport } });
  const born = Date.now();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.port}/?shot=flicker`);
  await page.locator(".feed [data-seq]").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: "* { caret-color: transparent !important; }" });
  const textarea = page.locator(".feed textarea").first();
  await textarea.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (scroll === "up") {
    const box = await page.locator(".feed").boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -2 * box.height);
    }
  }
  await page.waitForTimeout(600);
  if (focus === "on" && (await textarea.count()) > 0) await textarea.focus();
  else await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.mouse.move(2, 2);
  await page.waitForTimeout(2000);
  const b = await page.locator(".feed").boundingBox();
  const clip = b ? { x: Math.round(b.x + 72), y: Math.round(b.y), width: Math.round(b.width - 72), height: Math.round(b.height) } : null;
  const starts: number[] = [];
  for (let w = 0; w < windows; w++) {
    starts.push((Date.now() - born) / 1000);
    await page.waitForTimeout(seconds * 1000);
  }
  const control: { at: number; frames: number }[] = [];
  if (flag("--control", "off") === "on") {
    starts.push((Date.now() - born) / 1000);
    for (const frames of [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]) {
      control.push({ at: (Date.now() - born) / 1000 - starts[starts.length - 1]!, frames });
      await page.evaluate(
        (n) =>
          new Promise<void>((done) => {
            const list = document.querySelector<HTMLElement>(".feed > *");
            if (!list) return done();
            list.style.transform = "translateY(1px)";
            let left = n;
            const tick = () => {
              left--;
              if (left > 0) return requestAnimationFrame(tick);
              list.style.transform = "";
              done();
            };
            requestAnimationFrame(tick);
          }),
        frames,
      );
      await page.waitForTimeout(1000);
    }
  }
  const video = page.video();
  await context.close();
  const path = video ? await video.path() : "";
  if (path) renameSync(path, join(out, cell, "video.webm"));
  writeFileSync(join(out, cell, "meta.json"), JSON.stringify({ cell, viewport, scale, clip, windowStartsSeconds: starts, seconds, control }, null, 1));
  console.log(JSON.stringify({ cell, clip, starts }));
} finally {
  await browser.close();
  await server.stop(true);
}
