import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const dist = flag("--dist") ?? "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
const SIZES: readonly (readonly [number, number])[] = [
  [1710, 1074],
  [1280, 800],
];
const CONTROLS = [".top-drawer", ".top-here", ".top-tools .icon-btn:last-child", ".main .composer", ".rail-gear"];
const SIDE = [".tile.is-home", ".tile[data-code]", ".side-chan"];

type Places = Record<string, readonly [number, number] | null>;
interface Box {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
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
const base = `http://127.0.0.1:${server.port}/`;
const failures: string[] = [];
const expect = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const near = (a: number, b: number, by = 1): boolean => Math.abs(a - b) <= by;

const boxOf = (page: Page, selector: string): Promise<Box | null> =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);

const placesOf = (page: Page, selectors: readonly string[] = CONTROLS): Promise<Places> =>
  page.evaluate(
    (selectors) =>
      Object.fromEntries(
        selectors.map((s) => {
          const r = document.querySelector(s)?.getBoundingClientRect();
          return [s, r && r.width > 0 ? ([Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10] as const) : null];
        }),
      ),
    [...selectors],
  );

const moved = (a: Places, b: Places, skip: readonly string[] = []): string[] =>
  Object.keys(a)
    .filter((k) => !skip.includes(k) && a[k] && b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k} ${String(a[k])} → ${String(b[k])}`);

const open = async (page: Page, shot: string): Promise<void> => {
  await page.goto(`${base}?shot=${shot}&theme=dark`);
  await page.waitForSelector(".side-row", { state: "attached" });
  await page.waitForTimeout(900);
};

const browser = engine === "chromium" ? await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }) : await webkit.launch();
try {
  for (const [width, height] of SIZES) {
    console.log(`\n${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const mark = (): void => void (document.documentElement.dataset["shell"] = "mac");
      if (document.documentElement) mark();
      else document.addEventListener("DOMContentLoaded", mark);
    });
    await open(page, "channel");
    const title = await boxOf(page, ".top-here");
    const composer = await boxOf(page, ".main .composer");
    expect(!!title && near(title.x, width / 2), `the title is on the window's centre (${title?.x.toFixed(1)} of ${width / 2})`);
    expect(!!composer && near(composer.x, width / 2), `the composer is on the window's centre (${composer?.x.toFixed(1)} of ${width / 2})`);
    expect(
      !(await page.$(".tabs")) && (await page.evaluate(() => getComputedStyle(document.querySelector(".rail")!).gridColumnStart)) === "1",
      "no tab bar and no rail column: the channel tiles sit in the sidebar's column",
    );
    const shell = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const tiles = [...document.querySelectorAll(".rail .tile")].map((tile) => tile.getBoundingClientRect());
      const side = box(".side");
      const gear = box(".rail-gear");
      const first = box(".side-chan");
      return side && gear && first && tiles.length
        ? {
            rows: new Set(tiles.map((tile) => Math.round(tile.top))).size,
            sizes: [...new Set(tiles.map((tile) => `${tile.width}×${tile.height}`))],
            left: tiles[0]!.left,
            under: first.top - Math.max(...tiles.map((tile) => tile.bottom)),
            listEnd: side.bottom,
            gearTop: gear.top,
            gearFoot: innerHeight - gear.bottom,
          }
        : null;
    });
    const cropped = await page.evaluate(() => {
      const rail = document.querySelector(".rail");
      return !rail || getComputedStyle(rail).overflowY !== "visible" || getComputedStyle(rail).overflowX !== "visible";
    });
    expect(!cropped, "a tile's badge is not cropped by the row");
    expect(!!shell && shell.rows === 1 && shell.sizes.length === 1 && near(shell.left, 8), `the channel tiles are one size, in one row, 8px in (${shell?.sizes.join(", ")})`);
    expect(!!shell && near(shell.under, 16), `the channel's name starts 16px under the tiles (${shell?.under})`);
    expect(!!shell && shell.listEnd <= shell.gearTop && near(shell.gearFoot, 8), "Settings sits in the bottom-left corner, under the list");

    const side = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".side");
      if (!el) return null;
      const edges = (selector: string, text: boolean): number[] => [
        ...new Set(
          [...el.querySelectorAll(selector)].map((node) => {
            if (!text) return Math.round(node.getBoundingClientRect().left * 2) / 2;
            const range = document.createRange();
            range.selectNodeContents(node);
            return Math.round(range.getBoundingClientRect().left * 2) / 2;
          }),
        ),
      ];
      const on = el.querySelector<HTMLElement>(".side-row.is-on");
      const pill = new DOMMatrix(getComputedStyle(el, "::before").transform);
      return {
        text: edges(".side-label, .side-name", true),
        faces: edges(".side-member .av", false),
        resting: edges(".side-faces .av", false).slice(0, 1),
        sizes: [...new Set([...el.querySelectorAll(".side-member .av, .side-faces .av")].map((node) => Math.round(node.getBoundingClientRect().width * 10) / 10))],
        pillOff: on ? Math.round(el.getBoundingClientRect().top + pill.m42 - el.scrollTop - on.getBoundingClientRect().top) : 0,
        headTop: el.querySelector(".heading")?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(!!side && side.text.length === 1, `every sidebar row's text starts on one edge (${side?.text.join(", ")})`);
    expect(!!side && side.faces.length === 1 && (side.resting.length === 0 || side.resting[0] === side.faces[0]) && side.sizes.length === 1, "resting agents' faces share the rows' column and size");
    expect(!!side && side.pillOff === 0, "the open row's pill sits on its row");

    const tracker = await boxOf(page, ".track");
    if (tracker) {
      expect(near(width - tracker.right, 0), "the task tracker ends at the window's right edge");
      expect(!!composer && tracker.left >= composer.right + 8, "the task tracker clears the conversation");
    }
    const mine = await page.evaluate(() => {
      const bubble = document.querySelector(".msg.is-mine .msg-text")?.getBoundingClientRect();
      const theirs = document.querySelector(".msg:not(.is-mine) .msg-body")?.getBoundingClientRect();
      const list = document.querySelector(".msg.is-mine")?.getBoundingClientRect();
      return bubble && theirs && list ? { right: list.right - bubble.right, theirsLeft: theirs.left - list.left } : null;
    });
    if (mine) expect(near(mine.right, 16, 1) && mine.theirsLeft > 40, "your own message is a bubble on the right edge of the column, everyone else's starts on the left");

    const column = await page.evaluate(() => {
      const face = document.querySelector(".msg:not(.is-mine) .av")?.getBoundingClientRect();
      const bubble = document.querySelector(".msg.is-mine .msg-text")?.getBoundingClientRect();
      const box = document.querySelector(".main .composer")?.getBoundingClientRect();
      return face && bubble && box ? { left: face.left - box.left, right: box.right - bubble.right } : null;
    });
    if (column)
      expect(near(column.left, 0) && near(column.right, 0), `faces start on the composer's left edge and your bubbles end on its right edge (${column.left.toFixed(1)}, ${column.right.toFixed(1)})`);

    const HEAD = [".top-drawer", ".top-tools .icon-btn:last-child"];
    const pair = await page.evaluate(() => {
      const toggle = document.querySelector(".top-drawer")?.getBoundingClientRect();
      const search = document.querySelector(".top-tools .icon-btn:last-child")?.getBoundingClientRect();
      return toggle && search ? search.left - toggle.right : null;
    });
    expect(pair !== null && near(pair, 8), `Search sits 8px after the sidebar button (${pair})`);
    const before = await placesOf(page, HEAD);
    const sideBefore = await placesOf(page, SIDE);
    const chatBefore = await boxOf(page, ".main");
    await page.click(".top-drawer");
    await page.waitForTimeout(900);
    const hidden = moved(before, await placesOf(page, HEAD));
    const chatHidden = await boxOf(page, ".main");
    expect(hidden.length === 0, `hiding the sidebar moves no control${hidden.length ? `: ${hidden.join("; ")}` : ""}`);
    const titleHidden = await boxOf(page, ".top-here");
    expect(!!titleHidden && near(titleHidden.x, width / 2), `the title stays on the window's centre with the sidebar hidden (${titleHidden?.x.toFixed(1)})`);
    await page.mouse.move(2, height / 2);
    await page.waitForTimeout(900);
    const peek = await page.evaluate(() => {
      const side = document.querySelector(".side");
      const box = side?.getBoundingClientRect();
      const main = document.querySelector(".main")?.getBoundingClientRect();
      return box && main && side ? { on: !!document.querySelector(".chan.is-peek"), left: box.left, right: box.right, shown: getComputedStyle(side).visibility === "visible", main: main.left } : null;
    });
    expect(!!peek && peek.on && peek.shown && near(peek.left, 0) && near(peek.main, 0), `touching the left edge slides the hidden sidebar in over the conversation (${JSON.stringify(peek)})`);
    await page.mouse.move(width / 2, height / 2);
    await page.waitForTimeout(900);
    expect(!(await page.$(".chan.is-peek")), "moving away slides it out again");
    const clash = await page.evaluate(() => {
      const gear = document.querySelector(".rail-gear");
      const plus = document.querySelector(".main .compose-attach")?.getBoundingClientRect();
      const box = gear?.getBoundingClientRect();
      const shown = gear ? getComputedStyle(gear).visibility === "visible" : false;
      return !!plus && !!box && shown && box.right > plus.left && box.left < plus.right && box.bottom > plus.top && box.top < plus.bottom;
    });
    expect(!clash, "with the sidebar hidden, nothing sits on the composer's controls");
    expect(
      !!chatHidden && !!chatBefore && near(chatHidden.left, 0) && near(chatHidden.right, chatBefore.right),
      `hiding the sidebar gives its column to the conversation (${chatBefore?.left} → ${chatHidden?.left})`,
    );
    await page.click(".top-drawer");
    await page.waitForTimeout(900);
    const chatShown = await boxOf(page, ".main");
    const shown = [...moved(before, await placesOf(page, HEAD)), ...moved(sideBefore, await placesOf(page, SIDE))];
    expect(shown.length === 0 && !!chatShown && !!chatBefore && near(chatShown.left, chatBefore.left), `showing it again puts everything back${shown.length ? `: ${shown.join("; ")}` : ""}`);
    await page.click(".rail .tile[data-code]:not(.is-on):not(.is-waiting):not(.is-muted)");
    await page.waitForTimeout(900);
    const switched = moved(sideBefore, await placesOf(page, SIDE));
    expect(switched.length === 0, `switching channel moves no tile${switched.length ? `: ${switched.join("; ")}` : ""}`);
    await open(page, "channel");

    const all = await placesOf(page);
    await page.click(".top-tools .icon-btn:last-child");
    await page.waitForTimeout(1500);
    const find = await boxOf(page, ".top-find .search-field");
    const toggle = await boxOf(page, ".top-drawer");
    const tools = await boxOf(page, ".top-tools");
    expect(
      !!find && !!toggle && !!tools && near(find.left, toggle.right + 8) && near(tools.right - find.right, 8),
      `search grows from its button, beside the sidebar button (${find?.left} to ${find?.right})`,
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const slot = await boxOf(page, ".track");
    await page.click(".track-row");
    await page.waitForSelector("aside.panel");
    await page.waitForTimeout(900);
    const panel = await boxOf(page, "aside.panel");
    expect(
      !!slot && !!panel && near(slot.left, panel.left) && near(slot.top, panel.top) && near(slot.right, panel.right) && near(slot.bottom, panel.bottom),
      "a task opens in the very area the tracker was in",
    );
    const opened = moved(all, await placesOf(page));
    expect(opened.length === 0, `opening it moves nothing you click, the composer included${opened.length ? `: ${opened.join("; ")}` : ""}`);
    await page.click("aside.panel .panel-head .icon-btn:last-child");
    await page.waitForTimeout(900);
    expect(!!(await page.$(".track")), "closing it brings the tracker back");
    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }
  {
    console.log("\na panel dragged wider than its column");
    const page = await browser.newPage({ viewport: { width: 1710, height: 1074 } });
    await page.addInitScript(() => {
      try {
        localStorage.setItem("channels.panel.width", "490");
      } catch {
        // No storage in this browser: the default width is checked by the runs above.
      }
    });
    await open(page, "channel");
    await page.click(".track-row");
    await page.waitForSelector("aside.panel");
    await page.waitForTimeout(900);
    const panel = await boxOf(page, "aside.panel");
    const chat = await boxOf(page, ".main");
    const composer = await boxOf(page, ".main .composer");
    expect(!!panel && near(panel.right - panel.left, 490) && near(1710 - panel.right, 0), `the panel keeps the width it was dragged to (${panel ? panel.right - panel.left : "?"})`);
    expect(!!panel && !!chat && !!composer && near(chat.right, panel.left) && composer.right <= panel.left, "the conversation and its composer end where the panel starts");
    await page.close();
  }
  for (const [width, height] of [
    [1000, 760],
    [700, 760],
  ] as const) {
    console.log(`\n${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    await open(page, "channel");
    const tracker = await boxOf(page, ".track");
    const composer = await boxOf(page, ".main .composer");
    const main = await boxOf(page, ".main");
    expect(!tracker || tracker.right - tracker.left === 0, "a window too narrow for three columns has no task tracker");
    expect(!!main && near(main.right, width), "the conversation runs to the window's right edge");
    expect(!!composer && !!main && near(composer.left - main.left, main.right - composer.right, 1), "the composer is centred in the conversation");
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (failures.length) {
  console.error(`\n${failures.length} layout rule${failures.length === 1 ? "" : "s"} broken`);
  process.exit(1);
}
console.log("\nthe layout rules hold");
