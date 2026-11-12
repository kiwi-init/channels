import type { Page } from "playwright-core";

export interface Place {
  top: number;
  height: number;
  rows: number;
  first: number;
  last: number;
  under: number;
  room: number;
  pill: string;
}

export interface Row {
  seq: number;
  top: number;
}

export const place = (page: Page): Promise<Place> =>
  page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    const list = feed?.querySelector<HTMLElement>(".feed-list");
    if (!feed || !list) throw new Error("no feed on screen");
    const rows = [...list.querySelectorAll<HTMLElement>(":scope > [data-seq]")];
    const last = rows.at(-1);
    return {
      top: feed.scrollTop,
      height: list.getBoundingClientRect().height,
      rows: rows.length,
      first: Number(rows[0]?.dataset.seq ?? -1),
      last: Number(last?.dataset.seq ?? -1),
      under: last ? last.getBoundingClientRect().bottom - feed.getBoundingClientRect().bottom : Number.NaN,
      room: feed.querySelector<HTMLElement>(".feed-room")?.getBoundingClientRect().height ?? 0,
      pill:
        document
          .querySelector(".main .feed-jump")
          ?.textContent?.replace(/\s*↓\s*$/, "")
          .trim() ?? "",
    };
  });

export const topRow = (page: Page, seq: number | null): Promise<Row> =>
  page.evaluate((seq) => {
    const feed = document.querySelector<HTMLElement>(".main .feed");
    if (!feed) throw new Error("no feed on screen");
    const edge = feed.getBoundingClientRect().top;
    const rows = [...feed.querySelectorAll<HTMLElement>(".feed-list > [data-seq]")];
    const row = seq === null ? rows.find((r) => r.getBoundingClientRect().bottom > edge + 1) : rows.find((r) => Number(r.dataset.seq) === seq);
    return { seq: row ? Number(row.dataset.seq) : -1, top: row ? row.getBoundingClientRect().top - edge : Number.NaN };
  }, seq);

export const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate(
    (n) =>
      new Promise<void>((done) => {
        let left = n;
        const tick = () => (--left > 0 ? void requestAnimationFrame(tick) : done());
        requestAnimationFrame(tick);
      }),
    n,
  );

export async function rests(page: Page, want: (now: Place) => boolean, ms = 30_000): Promise<Place> {
  const t0 = Date.now();
  let now = await place(page);
  let held = 0;
  while (Date.now() - t0 < ms) {
    await frames(page, 6);
    const next = await place(page);
    held = want(next) && Math.abs(next.under - now.under) <= 0.5 && Math.abs(next.top - now.top) <= 0.5 && next.height === now.height ? held + 1 : 0;
    now = next;
    if (held >= 5) return now;
  }
  return now;
}

export async function wheelUp(page: Page, by: number): Promise<void> {
  const box = await page.locator(".main .feed").boundingBox();
  if (!box) throw new Error("no feed box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -by);
}

export const px = (n: number): string => (Number.isNaN(n) ? "nowhere" : `${Math.round(n * 10) / 10}px`);

export const serveDist = (dist: string) =>
  Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = Bun.file(`${dist}/${path === "/" || !path.includes(".") ? "index.html" : path}`);
      return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
    },
  });
