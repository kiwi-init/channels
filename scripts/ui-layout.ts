import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

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
const CONTROLS = [".top-drawer", ".top-tools .icon-btn:last-child", ".main .composer", ".rail-gear"];
const SIDE = [".tile.is-home", ".tile[data-code]", ".side-chan"];
const TABS = [".tile.is-home", ".tile[data-code]", ".tile.is-add"];
const LAYER_SHOTS = ["channel", "home", "waiting", "settings", "channel-broken", "closed", "welcome", "task-waiting", "specs"];

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

const clashes = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const parts = [...document.querySelectorAll(".top button, .top input, .rail .tile")].flatMap((el) => {
      const box = el.getBoundingClientRect();
      const shown = box.width > 0 && box.height > 0 && box.top < 48 && getComputedStyle(el).visibility !== "hidden";
      return shown ? [{ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24) || el.className.toString(), box }] : [];
    });
    return parts.flatMap((a, i) =>
      parts.slice(i + 1).flatMap((b) => (a.box.left < b.box.right && b.box.left < a.box.right && a.box.top < b.box.bottom && b.box.top < a.box.bottom ? [`${a.name} on ${b.name}`] : [])),
    );
  });
const nothingClashes = async (page: Page, where: string): Promise<void> => {
  const on = await clashes(page);
  expect(on.length === 0, `nothing in the top row sits on anything else, ${where}${on.length ? `: ${on.join("; ")}` : ""}`);
};

const NOW_PANE = ".panes > .pane:has(> .page.is-now)";
const NOW_ROW = ".page.is-now a[href^='kiwi-task:']";
const TASK_PANE = ".panes > .pane:has(.task-page)";
const gapOf = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const panes = document.querySelector(".panes");
    return panes ? parseFloat(getComputedStyle(panes).getPropertyValue("--pane-gap")) || 0 : 0;
  });
const boxOf = (page: Page, selector: string): Promise<Box | null> =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);

const peekSheet = (page: Page): Promise<{ top: number; side: number; tabs: number } | null> =>
  page.evaluate(() => {
    const app = document.querySelector(".app");
    const tabs = document.querySelector(".top")?.getBoundingClientRect();
    const side = document.querySelector(".side")?.getBoundingClientRect();
    return app && tabs && side ? { top: Number.parseFloat(getComputedStyle(app, "::before").top), side: side.top, tabs: tabs.bottom } : null;
  });

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
    await pageErrors(page, (e) => errors.push(e));
    await page.addInitScript(() => {
      const mark = (): void => void (document.documentElement.dataset["shell"] = "mac");
      if (document.documentElement) mark();
      else document.addEventListener("DOMContentLoaded", mark);
    });
    await open(page, "channel");
    const title = await boxOf(page, ".top-here");
    const composer = await boxOf(page, ".main .composer");
    expect(title === null, "the top strip has no title: the tabs take its place");
    expect(!!composer && near(composer.x, width / 2), `the composer is on the window's centre (${composer?.x.toFixed(1)} of ${width / 2})`);
    expect(
      !(await page.$(".tabs")) && (await page.evaluate(() => getComputedStyle(document.querySelector(".rail")!).gridRowStart)) === "1",
      "no rail column and no row of their own: the channels are tabs in the top strip",
    );
    const shell = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const tiles = [...document.querySelectorAll(".rail :is(.tile.is-home, .tile[data-code])")].map((tile) => tile.getBoundingClientRect());
      const side = box(".side");
      const gear = box(".rail-gear");
      const first = box(".side-chan");
      const toggle = box(".top-drawer");
      const strip = box(".top");
      const add = box(".tile.is-add");
      return side && gear && first && toggle && strip && add && tiles.length
        ? {
            rows: new Set(tiles.map((tile) => Math.round(tile.bottom))).size,
            sizes: [...new Set(tiles.map((tile) => tile.height))],
            left: tiles[0]!.left - side.right,
            foot: strip.bottom - Math.max(...tiles.map((tile) => tile.bottom)),
            add: add.top >= strip.top && add.bottom <= strip.bottom,
            under: first.top - strip.bottom,
            listEnd: side.bottom,
            gearTop: gear.top,
            gearFoot: innerHeight - gear.bottom,
          }
        : null;
    });
    const cropped = await page.evaluate(() => {
      const rail = document.querySelector(".rail")?.getBoundingClientRect();
      const out = (badge: Element): boolean => {
        const box = badge.getBoundingClientRect();
        return !rail || box.top < rail.top || box.bottom > rail.bottom || box.left < rail.left || box.right > rail.right;
      };
      return !rail || [...document.querySelectorAll(".rail .tile-badge")].some(out);
    });
    expect(!cropped, "a tab's badge is not cropped by the strip");
    expect(
      !!shell && shell.rows === 1 && shell.sizes.length === 1 && near(shell.left, 8),
      `Home and the channel tabs are one height, in one line, 8px after the page's left edge (${shell?.sizes.join(", ")} high, ${shell?.left} after)`,
    );
    expect(!!shell && near(shell.foot, 0) && shell.add, `standing on the strip's bottom edge, with + inside the strip (${shell?.foot} above it)`);
    await nothingClashes(page, "on the Mac");
    expect(!!shell && near(shell.under, 0), `the channel's name starts right under the tab strip (${shell?.under})`);
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
      const glide = getComputedStyle(el, "::before");
      const pill = new DOMMatrix(glide.transform);
      const row = on?.getBoundingClientRect();
      return {
        text: edges(".side-label, .side-name", true),
        faces: edges(".side-member .av", false),
        sizes: [...new Set([...el.querySelectorAll(".side-member .av")].map((node) => Math.round(node.getBoundingClientRect().width * 10) / 10))],
        pillOff: on ? Math.round(el.getBoundingClientRect().top + pill.m42 - el.scrollTop - on.getBoundingClientRect().top) : 0,
        pillOver: row ? [parseFloat(glide.width) - row.width, parseFloat(glide.height) - row.height].map((n) => Math.round(n * 2) / 2) : [],
        pillRound: parseFloat(glide.borderTopLeftRadius) > 0 && glide.maskImage === "none",
        pillEnd: row ? Math.round(el.getBoundingClientRect().right - row.right) : 0,
        headTop: el.querySelector(".heading")?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(!!side && side.text.length === 1, `every sidebar row's text starts on one edge (${side?.text.join(", ")})`);
    expect(!!side && side.faces.length === 1 && side.sizes.length === 1, "every sidebar face sits in one column, at one size");
    expect(!!side && side.pillOff === 0, "the open row's pill sits on its row");
    expect(
      !!side && side.pillOver.length === 2 && side.pillOver.every((n) => n === 0) && side.pillRound && side.pillEnd > 0,
      `and it is a pill the size of its row, ending before the sidebar's edge: nothing cuts into the page (${side?.pillOver.join(", ")} over, ${side?.pillEnd} before the edge)`,
    );

    const tracker = await boxOf(page, NOW_PANE);
    const gap = await gapOf(page);
    expect(!!tracker, "a wide window shows Now beside the conversation");
    if (tracker) {
      expect(near(width - tracker.right, gap), `Now ends one pane gap from the window's right edge (${width - tracker.right} of ${gap})`);
      expect(!!composer && tracker.left >= composer.right + 8, "Now clears the conversation");
      const second = await page.evaluate((sel) => {
        const now = document.querySelector(sel);
        const main = document.querySelector(".panes > .pane:not(:has(> .page.is-now))");
        return { onPage: !!now?.closest(".content"), fill: now ? getComputedStyle(now).backgroundColor : "", page: main ? getComputedStyle(main).backgroundColor : "" };
      }, NOW_PANE);
      expect(second.onPage && second.fill === second.page, `Now sits on the page, not on the frame, in the page's colour (${second.fill}, page ${second.page})`);
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
    const ends = await page.evaluate(() => {
      const search = document.querySelector(".top-tools > .icon-btn:last-child")?.getBoundingClientRect();
      const add = document.querySelector(".tile.is-add")?.getBoundingClientRect();
      return search && add ? { search: innerWidth - search.right, after: search.left - add.right } : null;
    });
    expect(!!ends && near(ends.search, 8) && ends.after >= 8, `Search sits at the far end of the top row, 8px in, after the tabs (${ends?.search} in, ${ends?.after} after)`);
    const before = await placesOf(page, HEAD);
    const sideBefore = await placesOf(page, SIDE);
    const tabsBefore = await placesOf(page, TABS);
    const chatBefore = await boxOf(page, ".main");
    await page.click(".top-drawer");
    await page.waitForTimeout(900);
    const hidden = moved(before, await placesOf(page, HEAD));
    const chatHidden = await boxOf(page, ".main");
    expect(hidden.length === 0, `hiding the sidebar moves no control${hidden.length ? `: ${hidden.join("; ")}` : ""}`);
    const tabsHidden = moved(tabsBefore, await placesOf(page, TABS));
    expect(tabsHidden.length === 0, `the tabs stay where they are with the sidebar hidden${tabsHidden.length ? `: ${tabsHidden.join("; ")}` : ""}`);
    await page.mouse.move(2, height / 2);
    await page.waitForTimeout(900);
    const peek = await page.evaluate(() => {
      const side = document.querySelector(".side");
      const box = side?.getBoundingClientRect();
      const main = document.querySelector(".main")?.getBoundingClientRect();
      return box && main && side ? { on: !!document.querySelector(".chan.is-peek"), left: box.left, right: box.right, shown: getComputedStyle(side).visibility === "visible", main: main.left } : null;
    });
    expect(
      !!peek && peek.on && peek.shown && near(peek.left, 0) && near(peek.main, await gapOf(page)),
      `touching the left edge slides the hidden sidebar in over the conversation (${JSON.stringify(peek)})`,
    );
    const sheet = await peekSheet(page);
    expect(
      !!sheet && sheet.top >= sheet.tabs && sheet.side >= sheet.tabs,
      `as a sheet that starts under the tab row, so its edge never crosses a tab (from ${sheet?.top}, the tabs end at ${sheet?.tabs}) (T339)`,
    );
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
      !!chatHidden && !!chatBefore && near(chatHidden.left, await gapOf(page)) && near(chatHidden.right, chatBefore.right),
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
    const tools = await boxOf(page, ".top-tools");
    expect(
      !!find && !!tools && near(find.right, width - 8) && near(tools.right - find.right, 8) && near(find.left - tools.left, 8),
      `search grows from its button, at the row's far end (${find?.left} to ${find?.right})`,
    );
    await page.getByRole("combobox").first().fill("bundle");
    await page.waitForTimeout(900);
    const reachable = await page.evaluate(() => {
      const option = document.querySelector('[role="listbox"] [role="option"]');
      const box = option?.getBoundingClientRect();
      const top = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
      return !!option && !!top && (option === top || option.contains(top));
    });
    expect(reachable, "a search result is on top of everything under it, the channel tiles included");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const slot = await boxOf(page, NOW_PANE);
    await page.locator(NOW_ROW).first().click();
    await page.waitForSelector(TASK_PANE);
    await page.waitForTimeout(900);
    const panel = await boxOf(page, TASK_PANE);
    expect(
      !!slot && !!panel && near(slot.left, panel.left) && near(slot.top, panel.top) && near(slot.right, panel.right) && near(slot.bottom, panel.bottom),
      "a task opens in the very area the tracker was in",
    );
    const opened = moved(all, await placesOf(page));
    expect(opened.length === 0, `opening it moves nothing you click, the composer included${opened.length ? `: ${opened.join("; ")}` : ""}`);
    await page.click(`${TASK_PANE} .icon-btn[aria-label="Close"]`);
    await page.waitForTimeout(900);
    expect(!!(await page.$(NOW_PANE)), "closing it brings Now back");
    expect(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
    await page.close();
  }
  {
    console.log("\na panel dragged wider than its column");
    const page = await browser.newPage({ viewport: { width: 1710, height: 1074 } });
    await open(page, "channel");
    const gap = await gapOf(page);
    const dock = await boxOf(page, NOW_PANE);
    const grip = await page.locator(".pane-gap.is-dock").boundingBox();
    if (dock && grip) {
      const [gx, gy] = [grip.x + grip.width / 2, grip.y + grip.height / 2];
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx - (490 - (dock.right - dock.left)), gy, { steps: 8 });
      await page.mouse.up();
    }
    await page.waitForTimeout(400);
    await open(page, "channel");
    await page.locator(NOW_ROW).first().click();
    await page.waitForSelector(TASK_PANE);
    await page.waitForTimeout(900);
    const panel = await boxOf(page, TASK_PANE);
    const chat = await boxOf(page, ".main");
    const composer = await boxOf(page, ".main .composer");
    expect(!!panel && near(panel.right - panel.left, 490, 2) && near(1710 - panel.right, gap), `the panel keeps the width it was dragged to (${panel ? panel.right - panel.left : "?"})`);
    expect(!!panel && !!chat && !!composer && near(chat.right + gap, panel.left) && composer.right <= panel.left, "the conversation and its composer end where the panel starts");
    await page.close();
  }
  {
    console.log("\nthe sidebar's agents");
    const page = await browser.newPage({ viewport: { width: 1280, height: 1180 } });
    await open(page, "channel");
    const agents = page.locator('.side section[aria-label="Agents"]');
    const row = (name: string) => agents.locator(`.side-row:has-text("${name}")`);
    expect((await row("atlas").count()) === 1 && (await row("pip").count()) === 1, "an agent with nothing to do keeps its own row");
    expect((await row("scout").count()) === 0, "an agent that left has no row");
    await agents.getByRole("button", { name: "1 hidden" }).click();
    expect((await row("scout").innerText()).includes("left"), "the hidden row brings it back, marked as left");
    await row("scout").click();
    await agents.getByRole("button", { name: "Show less" }).click();
    expect((await row("scout").count()) === 1 && (await agents.getByRole("button", { name: "1 hidden" }).count()) === 0, "it stays listed while its conversation is open");
    await page.locator('.side-row:has-text("general")').first().click();
    expect((await row("scout").count()) === 0 && (await agents.getByRole("button", { name: "1 hidden" }).count()) === 1, "and hides again once you go elsewhere");
    await page.close();
  }
  for (const [width, height] of SIZES) {
    console.log(`\nthe sidebar's width, ${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    await open(page, "channel");
    const sideWidth = async (): Promise<number> => {
      const side = await boxOf(page, ".side");
      return side ? side.right - side.left : 0;
    };
    const covered = async (): Promise<number> => {
      const side = await boxOf(page, ".side");
      const feed = await boxOf(page, ".main .feed");
      return side && feed ? Math.max(0, side.right - feed.left) : Number.NaN;
    };
    const grip = page.getByRole("separator", { name: "Resize the sidebar" });
    const gripBox = await grip.boundingBox();
    const sideBefore = await sideWidth();
    if (gripBox) {
      const [gx, gy] = [gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2];
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx + 61, gy, { steps: 6 });
      await page.mouse.up();
    }
    const sideWide = await sideWidth();
    const composerWide = await boxOf(page, ".main .composer");
    const trackWide = await boxOf(page, NOW_PANE);
    expect(!!gripBox && sideWide === sideBefore + 64, `dragging the sidebar's edge 61px widens it by 64, on the grid (${sideBefore} → ${sideWide})`);
    expect(!!composerWide && near(composerWide.x, width / 2), `the composer stays on the window's centre with a wider sidebar (${composerWide?.x.toFixed(1)} of ${width / 2})`);
    expect(!!trackWide && near(width - trackWide.left, sideWide), `and Now takes the same width on the right (${trackWide ? width - trackWide.left : "?"} of ${sideWide})`);
    await grip.focus();
    const under = [await covered()];
    await page.keyboard.press("Home");
    under.push(await covered());
    const sideLeast = await sideWidth();
    expect(sideLeast < sideBefore && sideLeast % 8 === 0, `Home takes it to its narrowest, on the grid (${sideLeast})`);
    await page.keyboard.press("End");
    under.push(await covered());
    const sideMost = await sideWidth();
    expect(sideMost > sideBefore && sideMost % 8 === 0 && width - 2 * sideMost >= 480, `End takes it to its widest, and the work keeps 480px (${sideMost})`);
    await grip.dblclick();
    expect((await sideWidth()) === sideBefore, "a double-click puts it back");
    await page.click(".top-drawer");
    await page.waitForTimeout(900);
    await page.click(".top-drawer");
    await page.waitForTimeout(900);
    under.push(await covered());
    expect(
      under.every((px) => px === 0),
      `at every width, and after hiding and showing it, no part of the conversation is under the sidebar (${under.join(", ")}px) (T339)`,
    );
    await page.close();
  }
  for (const mac of [false, true]) {
    for (const shot of ["settings-devices", "home"]) {
      console.log(`\n${shot}${mac ? ", on the Mac" : ""}`);
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      if (mac)
        await page.addInitScript(() => {
          const mark = (): void => void (document.documentElement.dataset["shell"] = "mac");
          if (document.documentElement) mark();
          else document.addEventListener("DOMContentLoaded", mark);
        });
      await page.goto(`${base}?shot=${shot}&theme=dark`);
      await page.waitForSelector(".tile.is-home", { state: "attached" });
      await page.waitForTimeout(900);
      const back = await boxOf(page, ".set-back");
      const home = await boxOf(page, ".tile.is-home");
      expect(!!home && home.bottom <= 48, "the tabs are in the top row");
      const open = await page.evaluate(() => [...document.querySelectorAll(".rail .tile.is-on")].map((tile) => (tile.classList.contains("is-home") ? "Home" : "a channel")));
      if (shot === "home") expect(open.length === 1 && open[0] === "Home", `Home is the one open tab (${open.join(", ") || "none"})`);
      else expect(open.length === 0, `Settings is no channel, so no tab is open (${open.join(", ") || "none"})`);
      const side = await boxOf(page, ".side");
      if (shot === "settings-devices")
        expect(
          !!back && !!side && back.left >= side.left && back.right <= side.right && back.top >= 48,
          `the Settings title heads the sidebar, under the top row (from ${back?.left} to ${back?.right}, ${back?.top} down)`,
        );
      await nothingClashes(page, "here");
      await page.close();
    }
  }
  for (const [width, height] of [
    [1440, 900],
    [1000, 760],
    [700, 760],
  ] as const) {
    for (const hidden of width > 760 ? [false, true] : [false]) {
      console.log(`\nthe two layers, ${width}×${height}${hidden ? ", sidebar hidden" : ""}`);
      const page = await browser.newPage({ viewport: { width, height } });
      if (hidden) await page.addInitScript(() => localStorage.setItem("mc.sidebar-hidden", "1"));
      const seen: { shot: string; area: string; top: string }[] = [];
      for (const shot of LAYER_SHOTS) {
        await open(page, shot);
        const layers = await page.evaluate(() => {
          const round = (r: DOMRect) => [r.left, r.top, r.right, r.bottom].map((n) => Math.round(n)).join(" ");
          const areas = [...document.querySelectorAll(".content")];
          const area = areas[0]?.getBoundingClientRect();
          const strip = document.querySelector(".top")?.getBoundingClientRect();
          const side = document.querySelector(".side");
          const stray = [...document.querySelectorAll(".main, .views-bar, .track, .panel, .set-main, .start-area, .crash")]
            .filter((el) => !el.closest(".content"))
            .map((el) => el.className.toString().split(" ")[0]);
          const shell = [...document.querySelectorAll(".top, .rail, .side")].filter((el) => el.closest(".content")).map((el) => el.className.toString().split(" ")[0]);
          const sheet = (el: Element): boolean => {
            const panel = el.closest(".panel");
            return !!panel && getComputedStyle(panel).position === "fixed";
          };
          const bar = strip ? Array.from({ length: 12 }, (_, n) => [((n + 0.5) * innerWidth) / 12, strip.bottom / 2] as const) : [];
          const column = area && area.left > 1 ? Array.from({ length: 8 }, (_, n) => [area.left / 2, area.top + ((n + 0.5) * (innerHeight - area.top)) / 8] as const) : [];
          const spill = [...bar, ...column].flatMap(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            return el?.closest(".content") && !sheet(el) ? [`${el.className.toString().split(" ")[0] || el.tagName.toLowerCase()} at ${Math.round(x)},${Math.round(y)}`] : [];
          });
          const painted = [...document.querySelectorAll(".top, .rail")].filter((el) => getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)").map((el) => el.className.toString().split(" ")[0]);
          return {
            areas: areas.length,
            area: area ? round(area) : "none",
            areaLeft: area?.left ?? -1,
            areaTop: area?.top ?? -1,
            top: strip ? round(strip) : "none",
            stripBottom: strip?.bottom ?? -1,
            sideRight: side && getComputedStyle(side).display !== "none" && getComputedStyle(side).position !== "fixed" ? side.getBoundingClientRect().right : null,
            hasSide: !!side,
            toggle: !!document.querySelector(".top .top-drawer, .top .set-back"),
            tools: document.querySelectorAll(".top .top-tools .icon-btn").length,
            stray,
            shell,
            spill,
            painted,
          };
        });
        seen.push({ shot, area: layers.area, top: layers.top });
        expect(
          layers.areas === 1 && layers.stray.length === 0,
          `${shot}: one content area holds everything on the page colour${layers.stray.length ? ` (outside it: ${layers.stray.join(", ")})` : ""}`,
        );
        expect(
          layers.hasSide && layers.toggle && layers.tools > 0 && layers.shell.length === 0,
          `${shot}: the shell has its top bar, its buttons and its sidebar, none of them inside the content area`,
        );
        expect(
          layers.spill.length === 0 && layers.painted.length === 0,
          `${shot}: nothing of the screen reaches into the shell${layers.spill.length ? ` (${layers.spill.join(", ")})` : ""}${layers.painted.length ? ` (painted: ${layers.painted.join(", ")})` : ""}`,
        );
        if (width > 760) {
          expect(near(layers.areaTop, layers.stripBottom), `${shot}: the content area starts under the top bar (${layers.areaTop} of ${layers.stripBottom})`);
          expect(
            hidden ? near(layers.areaLeft, 0) : layers.sideRight !== null && near(layers.areaLeft, layers.sideRight),
            `${shot}: and ${hidden ? "at the window's edge" : "where the sidebar ends"} (${layers.areaLeft})`,
          );
        }
      }
      const first = seen[0]!;
      const off = seen.filter((s) => s.area !== first.area || s.top !== first.top).map((s) => `${s.shot} ${s.area}`);
      if (width > 760) expect(off.length === 0, `the content area and the top bar are the same box on every screen (${first.area})${off.length ? `: ${off.join("; ")}` : ""}`);
      await page.close();
    }
  }
  for (const [shot, width, fit] of [
    ["tabs-3", 1710, "roomy"],
    ["tabs-8", 1710, "roomy"],
    ["tabs-8", 1560, "roomy"],
    ["tabs-8", 1280, "tight"],
    ["tabs-8", 900, "icons"],
  ] as const) {
    console.log(`\nthe tab strip, ${shot} at ${width} wide`);
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}?shot=${shot}&theme=dark`);
    await page.waitForSelector(".rail .tile[data-code]");
    await page.waitForTimeout(900);
    const strip = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>(".rail");
      const add = document.querySelector(".tile.is-add")?.getBoundingClientRect();
      const search = document.querySelector(".top-tools > .icon-btn:last-child")?.getBoundingClientRect();
      const top = document.querySelector(".top")?.getBoundingClientRect();
      const open = [...document.querySelectorAll<HTMLElement>(".rail .tile.is-on")];
      if (!rail || !add || !search || !top) return null;
      const tabs = [...rail.querySelectorAll<HTMLElement>(".tile[data-code]")].map((tab) => {
        const box = tab.getBoundingClientRect();
        const name = tab.querySelector<HTMLElement>(".tile-name");
        const last = tab.lastElementChild as HTMLElement;
        const icon = tab.firstElementChild?.getBoundingClientRect();
        return {
          name: name?.textContent ?? "",
          on: tab.classList.contains("is-on"),
          left: box.left,
          right: box.right,
          width: box.width,
          shown: !!name && name.clientWidth > 0,
          whole: !!name && name.clientWidth > 0 && name.scrollWidth <= name.clientWidth,
          spare: box.right - last.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(last).marginRight),
          icon: icon ? Math.round(icon.width) : 0,
        };
      });
      const shade = (el: Element): string => getComputedStyle(el).backgroundColor;
      return {
        fit: rail.dataset["fit"],
        over: rail.scrollWidth - rail.clientWidth,
        page: (document.scrollingElement?.scrollWidth ?? 0) - innerWidth,
        rem: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
        tabs,
        addLeft: add.left,
        addRight: add.right,
        search: search.left,
        foot: top.bottom,
        open: open.map((tab) => ({ bottom: tab.getBoundingClientRect().bottom, shade: shade(tab) })),
        ground: shade(document.querySelector(".main")!),
        frame: shade(document.querySelector(".app")!),
      };
    });
    const tabs = strip?.tabs ?? [];
    const widths = tabs.map((tab) => tab.width);
    const least = Math.min(...widths);
    const even = tabs.filter((tab) => near(tab.width, least, 1));
    const wider = tabs.filter((tab) => !near(tab.width, least, 1));
    expect(strip?.fit === fit, `the strip is ${fit} here (${strip?.fit})`);
    expect(!!strip && strip.over <= 1 && strip.page <= 0, `nothing scrolls sideways (${strip?.over}px over in the strip, ${strip?.page}px in the page)`);
    expect(
      !!strip && strip.open.length === 1 && near(strip.open[0]!.bottom, strip.foot) && strip.open[0]!.shade === strip.ground && strip.frame !== strip.ground,
      `one tab is open, in the page's colour and joined to it, on the frame's (${strip?.open.length} open, ${strip?.open[0]?.bottom} of ${strip?.foot}, ${strip?.ground} on ${strip?.frame})`,
    );
    expect(!!strip && near(strip.addRight + 8, strip.search, 9) && tabs.every((tab) => tab.right <= strip.addLeft + 1), `+ ends the strip, beside Search (${strip?.addRight} before ${strip?.search})`);
    expect(tabs.length > 0 && tabs.every((tab) => tab.icon === 16), `every tab's icon is 16px (${[...new Set(tabs.map((tab) => tab.icon))].join(", ")})`);
    await nothingClashes(page, `with ${shot} at ${width}`);
    if (fit === "roomy") {
      expect(
        tabs.every((tab) => tab.whole),
        `every name is whole (${
          tabs
            .filter((tab) => !tab.whole)
            .map((tab) => tab.name)
            .join(", ") || "all"
        })`,
      );
      expect(even.length >= 2 && wider.every((tab) => tab.spare <= 13), `tabs are equal shares, and a wider one is only as wide as its name needs (${widths.map((w) => Math.round(w)).join(", ")})`);
      if (shot === "tabs-3") expect(!!strip && wider.length === 0 && near(least, 15 * strip.rem, 1), `with room to spare a tab stops at 15rem (${Math.round(least)})`);
      else
        expect(
          !!strip && near(tabs.at(-1)!.right, strip.addLeft, 1) && wider.length > 0,
          `the tabs fill the strip, and a long name takes the room its neighbours don't use (${wider.map((tab) => tab.name).join(", ")})`,
        );
    }
    if (fit === "tight") {
      const cut = tabs.filter((tab) => !tab.whole);
      const whole = tabs.filter((tab) => tab.whole);
      expect(
        cut.length > 0 && whole.length > 0 && Math.min(...cut.map((tab) => tab.width)) >= Math.max(...whole.map((tab) => tab.width)) - 1,
        `out of room, only the longest names are cut, to one width (${cut.map((tab) => `${tab.name} ${Math.round(tab.width)}`).join(", ")}; whole up to ${Math.round(Math.max(...whole.map((tab) => tab.width)))})`,
      );
      expect(!!strip && near(tabs.at(-1)!.right, strip.addLeft, 1), "and the tabs still fill the strip");
    }
    if (fit === "icons") {
      const rest = tabs.filter((tab) => !tab.on);
      expect(rest.length > 0 && rest.every((tab) => !tab.shown) && tabs.filter((tab) => tab.on).every((tab) => tab.whole), "too many to name: tabs are their icons, and the open one keeps its name");
      expect(Math.max(...rest.map((tab) => tab.width)) - Math.min(...rest.map((tab) => tab.width)) <= 1, `in equal shares (${rest.map((tab) => Math.round(tab.width)).join(", ")})`);
    }
    await page.close();
  }
  for (const [width, height] of [
    [1000, 760],
    [700, 760],
  ] as const) {
    console.log(`\n${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    await open(page, "channel");
    const tracker = await boxOf(page, NOW_PANE);
    const composer = await boxOf(page, ".main .composer");
    const main = await boxOf(page, ".main");
    const edge = (await page.$(".panes")) ? await gapOf(page) : 0;
    expect(!tracker || tracker.right - tracker.left === 0, "a window too narrow for three columns has no Now column");
    expect(!!main && near(main.right, width - edge), `the conversation runs to the window's right edge (${main?.right} of ${width - edge})`);
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
