import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const FIRST_REPLY = 113;
const LAST_REPLY = 115;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const browser = await chromium.launch();
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function shown(shot: string): Promise<{ scrolls: boolean; first: boolean; last: boolean }> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 360 }, reducedMotion: "reduce" });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
  const panel = page.locator(".panel .feed");
  await panel.locator(`[data-seq="${LAST_REPLY}"]`).waitFor();
  await page.waitForTimeout(300);
  const result = await panel.evaluate(
    (feed, seqs) => {
      const inView = (seq: number): boolean => {
        const el = feed.querySelector(`[data-seq="${seq}"]`);
        if (!el) return false;
        const box = el.getBoundingClientRect();
        const view = feed.getBoundingClientRect();
        return box.top >= view.top - 1 && box.top < view.bottom;
      };
      return { scrolls: feed.scrollHeight > feed.clientHeight + 8, first: inView(seqs[0]!), last: inView(seqs[1]!) };
    },
    [FIRST_REPLY, LAST_REPLY],
  );
  await page.close();
  return result;
}

try {
  const plain = await shown("thread");
  expect(plain.scrolls, "the thread overflows a short window, so where it lands matters");
  expect(plain.last && !plain.first, "a thread opened plainly lands on its newest reply");
  const focused = await shown("thread-focus");
  expect(focused.first, "a thread opened on one reply (as View on a notification does) shows that reply, not the bottom");
} finally {
  await browser.close();
  server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
