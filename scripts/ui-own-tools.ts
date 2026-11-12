import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-own-tools.ts [--dist ui/dist] [--browser webkit|chromium]\n\nYour own message shows its hover tools only over the bubble, what hangs on it, or the tools; they sit beside the bubble when its line has room, above it when not, and never on its words.",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const EMPTY = 40;
const STEP = 2;
const GAP = 6;
const EDGE = 8;
const PARTS: readonly (readonly [string, string])[] = [
  ["the quote", ".msg-quote"],
  ["the picture", ".msg-image"],
  ["the task chip", ".chip"],
  ["a reaction", ".reacts > :first-child"],
  ["the replies line", ".msg-thread"],
];

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

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Row {
  seq: string;
  mine: boolean;
  compact: boolean;
  row: Box;
  body: Box;
  bubble: Box | null;
  words: Box[];
  parts: { name: string; box: Box }[];
}

interface Tools {
  shown: boolean;
  box: Box;
  under: boolean;
}

const rowsOf = (page: Page): Promise<{ seq: string; mine: boolean }[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".main article.msg")].flatMap((row) =>
      row.querySelector(":scope > .msg-tools") ? [{ seq: row.dataset.seq ?? "", mine: row.classList.contains("is-mine") }] : [],
    ),
  );

const read = (page: Page, seq: string, parts: readonly (readonly [string, string])[]): Promise<Row> =>
  page.evaluate(
    ({ seq, parts }) => {
      const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      const row = document.querySelector<HTMLElement>(`.main article.msg[data-seq="${seq}"]`);
      const body = row?.querySelector<HTMLElement>(":scope > .msg-body");
      if (!row || !body) throw new Error(`no row #${seq}`);
      const bubble = row.querySelector<HTMLElement>(".msg-text");
      const words: Box[] = [];
      if (bubble) {
        const range = document.createRange();
        const walk = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (!n.nodeValue?.trim()) continue;
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) words.push(box(r));
        }
      }
      return {
        seq,
        mine: row.classList.contains("is-mine"),
        compact: row.classList.contains("is-compact"),
        row: box(row.getBoundingClientRect()),
        body: box(body.getBoundingClientRect()),
        bubble: bubble ? box(bubble.getBoundingClientRect()) : null,
        words,
        parts: parts.flatMap(([name, selector]) => {
          const el = body.querySelector(selector);
          return el ? [{ name, box: box(el.getBoundingClientRect()) }] : [];
        }),
      };
    },
    { seq, parts },
  );

const wordsOf = (page: Page): Promise<{ seq: string; box: Box }[]> =>
  page.evaluate(() => {
    const out: { seq: string; box: Box }[] = [];
    const range = document.createRange();
    for (const row of document.querySelectorAll<HTMLElement>(".main article.msg")) {
      const body = row.querySelector<HTMLElement>(":scope > .msg-body");
      if (!body) continue;
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.nodeValue?.trim()) continue;
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) out.push({ seq: row.dataset.seq ?? "", box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } });
      }
    }
    return out;
  });

const tools = (page: Page, seq: string, x: number, y: number): Promise<Tools> =>
  page.evaluate(
    ({ seq, x, y }) => {
      const el = document.querySelector<HTMLElement>(`.main article.msg[data-seq="${seq}"] > .msg-tools`);
      if (!el) throw new Error(`no tools on #${seq}`);
      const r = el.getBoundingClientRect();
      return {
        shown: getComputedStyle(el).display !== "none" && r.width > 0,
        box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
        under: el.contains(document.elementFromPoint(x, y)),
      };
    },
    { seq, x, y },
  );

const px = (n: number): string => `${Math.round(n * 10) / 10}px`;
const mid = (b: Box): [number, number] => [(b.left + b.right) / 2, (b.top + b.bottom) / 2];
const covered = (a: Box, b: Box): number => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

async function into(page: Page, seq: string): Promise<void> {
  await page.locator(`.main article.msg[data-seq="${seq}"]`).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

async function away(page: Page): Promise<void> {
  const top = await page.evaluate(() => document.querySelector(".top")?.getBoundingClientRect().bottom ?? 0);
  await page.mouse.move((page.viewportSize()?.width ?? 1200) / 2, Math.max(4, top / 2));
}

interface Told {
  empty: string[];
  emptied: number;
  hidden: string[];
  cover: string[];
  lost: string[];
  reached: string[];
  parts: string[];
  named: Set<string>;
  oneLine: number;
  beside: number;
  above: number;
  place: string[];
}

async function mine(page: Page, seq: string, told: Told): Promise<void> {
  await into(page, seq);
  await away(page);
  const at = await read(page, seq, PARTS);
  if (!at.bubble) return;
  const [bx, by] = mid(at.bubble);
  const room = at.body.left - at.row.left;
  if (room >= EMPTY) {
    const x = at.row.left + room / 2;
    await page.mouse.move(x, by);
    if ((await tools(page, seq, x, by)).shown) told.empty.push(`#${seq} (${px(room)} of empty line)`);
    told.emptied += 1;
  }
  await page.mouse.move(bx, by);
  const over = await tools(page, seq, bx, by);
  if (!over.shown) {
    told.hidden.push(`#${seq}`);
    return;
  }
  const lines = new Set(at.words.map((w) => Math.round(w.top / 4))).size;
  if (lines === 1 && at.compact) told.oneLine += 1;
  const wide = over.box.right - over.box.left;
  const fits = at.bubble.left - at.row.left >= wide + GAP + EDGE;
  const beside = over.box.right <= at.bubble.left + 0.5;
  const what = `${lines === 1 ? "one line" : `${lines} lines`}${at.compact ? ", in a run" : ""}`;
  if (beside) {
    told.beside += 1;
    const gap = at.bubble.left - over.box.right;
    if (!fits) told.place.push(`#${seq}: beside the bubble with only ${px(at.bubble.left - at.row.left)} of line for ${px(wide)} of tools`);
    else if (Math.abs(gap - GAP) > 0.6 || Math.abs(over.box.top - at.bubble.top) > 0.6 || over.box.left < at.row.left + EDGE - 0.5)
      told.place.push(`#${seq}: ${px(gap)} from the bubble, ${px(over.box.top - at.bubble.top)} under its top edge, ${px(over.box.left - at.row.left)} into the line`);
    const hit = (await wordsOf(page)).filter((w) => covered(over.box, w.box) > 0.5);
    if (hit.length) told.cover.push(`#${seq} (${what}: beside the bubble, the tools are on words of ${[...new Set(hit.map((w) => `#${w.seq}`))].join(", ")})`);
  } else {
    told.above += 1;
    if (fits) told.place.push(`#${seq}: above the bubble though its line has ${px(at.bubble.left - at.row.left)} for ${px(wide)} of tools`);
    else if (Math.abs(over.box.bottom - at.row.top - (at.compact ? 4 : 6)) > 0.6 || Math.abs(over.box.right - at.body.right) > 0.6)
      told.place.push(`#${seq}: without room, the tools end ${px(over.box.bottom - at.row.top)} under the top of its line and ${px(at.body.right - over.box.right)} from the message's right edge`);
    const on = at.words.reduce((sum, w) => sum + covered(over.box, w), 0);
    if (on > 0.5) told.cover.push(`#${seq} (${what}: the tools end ${px(over.box.bottom - Math.min(...at.words.map((w) => w.top)))} below the top of its words)`);
  }
  const [tx, ty] = mid(over.box);
  const path: [number, number][] = [];
  if (beside) {
    const y = Math.min(Math.max(ty, at.bubble.top + 2), at.bubble.bottom - 2);
    for (let x = at.bubble.left + 8; x > tx; x -= STEP) path.push([x, y]);
    path.push([tx, y]);
  } else {
    const x = Math.min(Math.max(bx, over.box.left + 6), over.box.right - 6);
    if (x < at.bubble.left || x > at.bubble.right)
      told.lost.push(`#${seq}: the tools are not above or over the bubble (${px(over.box.left)} to ${px(over.box.right)} against ${px(at.bubble.left)} to ${px(at.bubble.right)})`);
    else {
      for (let y = Math.min(at.bubble.top + 8, by); y > ty; y -= STEP) path.push([x, y]);
      path.push([x, ty]);
    }
  }
  if (path.length) {
    const [fx, fy] = path[0]!;
    await page.mouse.move(fx, fy);
    for (const [x, y] of path) {
      await page.mouse.move(x, y);
      if ((await tools(page, seq, x, y)).shown) continue;
      told.lost.push(`#${seq}: gone at ${px(x)}, ${px(y)}, between the bubble (from ${px(at.bubble.left)}, ${px(at.bubble.top)}) and the tools (to ${px(over.box.right)}, ${px(over.box.bottom)})`);
      break;
    }
    const [lx, ly] = path.at(-1)!;
    const there = await tools(page, seq, lx, ly);
    if (!there.shown || !there.under) told.reached.push(`#${seq}${there.shown ? ": something else is under the pointer" : ": hidden"}`);
  }
  for (const part of at.parts) {
    await away(page);
    const [x, y] = mid(part.box);
    await page.mouse.move(x, y);
    told.named.add(part.name);
    if (!(await tools(page, seq, x, y)).shown) told.parts.push(`${part.name} of #${seq}`);
  }
  await away(page);
  if ((await tools(page, seq, 0, 0)).shown) told.hidden.push(`#${seq} still shows them with the pointer away`);
}

async function theirs(page: Page, seq: string, rem: number): Promise<string[]> {
  await into(page, seq);
  await away(page);
  const at = await read(page, seq, []);
  const y = (at.row.top + at.row.bottom) / 2;
  const said: string[] = [];
  for (const [name, x] of [
    ["its left end", at.row.left + 12],
    ["its middle", (at.row.left + at.row.right) / 2],
    ["its right end", at.row.right - 12],
  ] as const) {
    await away(page);
    await page.mouse.move(x, y);
    const seen = await tools(page, seq, x, y);
    if (!seen.shown) said.push(`#${seq} hides them at ${name}`);
    else if (Math.abs(at.row.top - seen.box.top - 0.875 * rem) > 0.6 || Math.abs(at.row.right - seen.box.right - 12) > 0.6)
      said.push(`#${seq} has them ${px(at.row.top - seen.box.top)} above its top and ${px(at.row.right - seen.box.right)} from its right edge`);
  }
  return said;
}

async function keys(page: Page): Promise<string> {
  await away(page);
  const seq = await page.evaluate(() => document.querySelector<HTMLElement>(".main article.msg.is-mine:has(.msg-thread)")?.dataset.seq ?? "");
  if (!seq) return "no message of yours has a replies line to focus";
  await into(page, seq);
  await page.locator(`.main article.msg[data-seq="${seq}"] .msg-thread`).focus();
  if (!(await tools(page, seq, 0, 0)).shown) return `focus on the replies line of #${seq} does not show them`;
  const inside = await page.evaluate((seq) => {
    document.querySelector<HTMLElement>(`.main article.msg[data-seq="${seq}"] > .msg-tools .msg-tool`)?.focus();
    return !!document.activeElement?.closest(`.main article.msg[data-seq="${seq}"] > .msg-tools`);
  }, seq);
  if (!inside) return `with the replies line of #${seq} focused, a tool cannot take focus`;
  if (!(await tools(page, seq, 0, 0)).shown) return `with a tool of #${seq} focused they are hidden`;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  return (await tools(page, seq, 0, 0)).shown ? `with focus gone from #${seq} they still show` : "";
}

try {
  for (const width of [1440, 760]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (e) => fails.push(`page threw at ${width}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${server.port}/?shot=own-bubbles&theme=dark`);
    await page.locator(".main article.msg.is-mine .msg-thread").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".main article.msg.is-mine .msg-text")].every((bubble) => !bubble.querySelector(".md-plain") && bubble.querySelector(".md")?.textContent?.trim()),
    );
    await page.waitForTimeout(400);
    const rem = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
    const rows = await rowsOf(page);
    const told: Told = { empty: [], emptied: 0, hidden: [], cover: [], lost: [], reached: [], parts: [], named: new Set(), oneLine: 0, beside: 0, above: 0, place: [] };
    const own = rows.filter((r) => r.mine);
    for (const r of own) await mine(page, r.seq, told);
    const at = `${width} wide`;
    const list = (all: string[]): string => all.map((s) => `, ${s}`).join("");
    expect(own.length === 7 && told.emptied >= 3, `${at}: the scene has seven messages of yours with their tools, three or more with an empty part of the line (${own.length}, ${told.emptied})`);
    expect(told.empty.length === 0, `${at}: the pointer over the empty part of your own line shows no tools${list(told.empty)}`);
    expect(told.hidden.length === 0, `${at}: the pointer over the bubble shows them, and away from the message they are gone${list(told.hidden)}`);
    expect(
      told.place.length === 0 && told.beside > 0,
      `${at}: with room on its line the tools sit beside the bubble, ${GAP}px to its left and level with its top, and above its right end, where they were, only without room (${told.beside} beside, ${told.above} above)${list(told.place)}`,
    );
    expect(
      told.cover.length === 0 && told.oneLine > 0,
      `${at}: beside the bubble the tools are on no message's words, the bubble above in a run too, and above it never on its own (${told.oneLine} one-line in a run)${list(told.cover)}`,
    );
    expect(told.lost.length === 0, `${at}: moving from the bubble to the tools, ${STEP}px at a time, never hides them${list(told.lost)}`);
    expect(told.reached.length === 0, `${at}: the pointer on the tools keeps them, and it is a tool that is under it${list(told.reached)}`);
    expect(
      told.parts.length === 0 && told.named.size === PARTS.length,
      `${at}: the quote, the picture, the task chip, a reaction and the replies line each show them (${[...told.named].join(", ")})${list(told.parts)}`,
    );
    const focus = await keys(page);
    expect(focus === "", `${at}: keyboard focus inside your message shows them, a tool can take focus and keeps them, and they go when focus leaves${focus && ` (${focus})`}`);
    const others = rows.filter((r) => !r.mine);
    const wrong: string[] = [];
    for (const r of others) wrong.push(...(await theirs(page, r.seq, rem)));
    expect(
      others.length >= 4 && wrong.length === 0,
      `${at}: someone else's message shows them anywhere on its line, 0.875rem above its top and 12px from its right edge, as before (${others.length} messages)${list(wrong)}`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}`);
  process.exit(1);
}
console.log(`\nyour own message's tools show only over it, in ${engine}`);
