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
const CONTROLS = [".top-drawer", ".top-tools .icon-btn:last-child", ".main .composer", ".rail-gear"];
const SIDE = [".tile.is-home", ".tile[data-code]", ".side-chan"];
const TABS = [".tile.is-home", ".tile[data-code]", ".tile.is-add"];

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
    expect(title === null, "the top strip has no title: the tabs take its place");
    expect(!!composer && near(composer.x, width / 2), `the composer is on the window's centre (${composer?.x.toFixed(1)} of ${width / 2})`);
    expect(
      !(await page.$(".tabs")) && (await page.evaluate(() => getComputedStyle(document.querySelector(".rail")!).gridRowStart)) === "1",
      "no rail column and no row of their own: the channels are tabs in the top strip",
    );
    const shell = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const tiles = [...document.querySelectorAll(".rail .tile")].map((tile) => tile.getBoundingClientRect());
      const side = box(".side");
      const gear = box(".rail-gear");
      const first = box(".side-chan");
      const toggle = box(".top-drawer");
      return side && gear && first && toggle && tiles.length
        ? {
            rows: new Set(tiles.map((tile) => Math.round(tile.top))).size,
            sizes: [...new Set(tiles.map((tile) => tile.height))],
            left: tiles[0]!.left - toggle.right,
            under: first.top - Math.max(...tiles.map((tile) => tile.bottom)),
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
      !!shell && shell.rows === 1 && shell.sizes.length === 1 && near(shell.left, 16),
      `the channel tabs are one height, in one line, 16px after the sidebar button (${shell?.sizes.join(", ")} high, ${shell?.left} after)`,
    );
    await nothingClashes(page, "on the Mac");
    expect(!!shell && near(shell.under, 8), `the channel's name starts 8px under the tabs (${shell?.under})`);
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
        sizes: [...new Set([...el.querySelectorAll(".side-member .av")].map((node) => Math.round(node.getBoundingClientRect().width * 10) / 10))],
        pillOff: on ? Math.round(el.getBoundingClientRect().top + pill.m42 - el.scrollTop - on.getBoundingClientRect().top) : 0,
        headTop: el.querySelector(".heading")?.getBoundingClientRect().top ?? 0,
      };
    });
    expect(!!side && side.text.length === 1, `every sidebar row's text starts on one edge (${side?.text.join(", ")})`);
    expect(!!side && side.faces.length === 1 && side.sizes.length === 1, "every sidebar face sits in one column, at one size");
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
    const trackWide = await boxOf(page, ".track");
    expect(!!gripBox && sideWide === sideBefore + 64, `dragging the sidebar's edge 61px widens it by 64, on the grid (${sideBefore} → ${sideWide})`);
    expect(!!composerWide && near(composerWide.x, width / 2), `the composer stays on the window's centre with a wider sidebar (${composerWide?.x.toFixed(1)} of ${width / 2})`);
    expect(!trackWide || near(trackWide.right - trackWide.left, sideWide), "and the second sidebar takes the same width");
    await grip.focus();
    await page.keyboard.press("Home");
    const sideLeast = await sideWidth();
    expect(sideLeast < sideBefore && sideLeast % 8 === 0, `Home takes it to its narrowest, on the grid (${sideLeast})`);
    await page.keyboard.press("End");
    const sideMost = await sideWidth();
    expect(sideMost > sideBefore && sideMost % 8 === 0 && width - 2 * sideMost >= 480, `End takes it to its widest, and the work keeps 480px (${sideMost})`);
    await grip.dblclick();
    expect((await sideWidth()) === sideBefore, "a double-click puts it back");
    await page.close();
  }
  for (const [width, height] of SIZES) {
    console.log(`\nthe top bar layout, ${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    await open(page, "channel-top");
    const strip = await boxOf(page, ".top");
    const toggle = await boxOf(page, ".top-drawer");
    const search = await boxOf(page, ".top-tools > .icon-btn:last-child");
    const home = await boxOf(page, ".tile.is-home");
    const tab = await boxOf(page, ".tile[data-code]");
    const add = await boxOf(page, ".tile.is-add");
    const bar = await boxOf(page, ".views-bar ul");
    const icon = await boxOf(page, ".views-bar .side-icon");
    const main = await boxOf(page, ".main");
    const side = await boxOf(page, ".side");
    const title = await boxOf(page, ".top-here");
    const named = (): Promise<boolean[]> =>
      page.evaluate(() => [...document.querySelectorAll(".tile[data-code] .tile-name")].map((name) => name.clientWidth > 0 && name.scrollWidth <= name.clientWidth));
    const names = await named();
    const rows = await page.evaluate(() => [...document.querySelectorAll(".views-bar .side-row")].map((row) => Math.round(row.getBoundingClientRect().top)));
    expect(
      !!strip && !!home && !!tab && !!add && home.bottom <= strip.bottom && near(home.y, tab.y) && near(tab.y, add.y),
      `the channels are one line of tabs in the top strip (${home?.y}, ${tab?.y}, ${add?.y} of ${strip?.bottom})`,
    );
    expect(!!toggle && !!home && home.left >= toggle.right, `the tabs start after the sidebar button (${home?.left} after ${toggle?.right})`);
    expect(!!search && !!add && add.right <= search.left && near(search.right, width - 8), `and end before Search, at the row's far end (${add?.right} before ${search?.left})`);
    await nothingClashes(page, "in Top bar");
    expect(names.length > 0 && names.every(Boolean), `every tab shows its channel's whole name (${names.filter(Boolean).length} of ${names.length})`);
    expect(rows.length >= 3 && new Set(rows).size === 1, `the views are one row (${rows.length} in ${new Set(rows).size} row)`);
    expect(!!bar && !!strip && bar.top >= strip.bottom, `on their own line, under the tabs (${bar?.top} of ${strip?.bottom})`);
    expect(!!icon && !!side && near(icon.left, side.right + 40), `starting on the work's gutter line (${icon?.left} after ${side?.right})`);
    expect(!!bar && !!main && near(main.top, bar.bottom + 8), `the work starts right under them (${main?.top} after ${bar?.bottom})`);
    expect(!!side && !!strip && near(side.top, strip.bottom), `the sidebar starts right under the tabs (${side?.top} of ${strip?.bottom})`);
    expect((await page.locator(".side .side-views .side-row").count()) === 0 && (await page.locator(".side .side-chan").count()) === 1, "the sidebar keeps the channel's name and loses the view rows");
    expect(title === null, "the strip has no title");
    await page.locator(".top-tools .icon-btn").last().click();
    await page.waitForTimeout(500);
    const find = await boxOf(page, ".top-find");
    const tabs = await boxOf(page, ".rail");
    expect(!!find && !!tabs && tabs.right <= find.left && near(find.right, width - 8), `the search field opens at the far end and the tabs make room for it (${tabs?.right} before ${find?.left})`);
    await nothingClashes(page, "while searching");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await page.locator(".views-bar .side-row", { hasText: "Specs" }).click();
    await page.waitForTimeout(300);
    expect((await page.locator('.views-bar .side-row[aria-pressed="true"]').innerText()).includes("Specs"), "a view opens from its row and shows as chosen");
    const edge = await boxOf(page, ".side-grip");
    if (edge) {
      await page.mouse.move(edge.x, edge.y);
      await page.mouse.down();
      await page.mouse.move(edge.x + 61, edge.y, { steps: 6 });
      await page.mouse.up();
    }
    const sideAfter = await boxOf(page, ".side");
    const homeAfter = await boxOf(page, ".tile.is-home");
    expect(!!edge && !!side && !!sideAfter && sideAfter.right === side.right + 64, `the sidebar's edge drags (${side?.right} → ${sideAfter?.right})`);
    expect(!!home && !!homeAfter && homeAfter.left === home.left, `and the tabs stay where they are (${homeAfter?.left})`);
    await page.close();
    const bare = await browser.newPage({ viewport: { width, height } });
    await bare.addInitScript(() => localStorage.setItem("mc.sidebar-hidden", "1"));
    await open(bare, "channel-top");
    const taken = (): Promise<boolean[]> =>
      bare.evaluate(() =>
        [...document.querySelectorAll(".rail .tile")].map((tile) => {
          const r = tile.getBoundingClientRect();
          return tile.contains(document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2));
        }),
      );
    const hidden = await taken();
    const work = await boxOf(bare, ".main");
    const homeBare = await boxOf(bare, ".tile.is-home");
    const iconBare = await boxOf(bare, ".views-bar .side-icon");
    expect(hidden.length > 0 && hidden.every(Boolean), `with the sidebar hidden, the tabs stay and take the click (${hidden.filter(Boolean).length} of ${hidden.length})`);
    expect(!!home && !!homeBare && homeBare.left === home.left, `where they were (${homeBare?.left})`);
    expect(!!work && near(work.left, 0) && !!iconBare && near(iconBare.left, 40), `the work and the views take the sidebar's place (${work?.left} and ${iconBare?.left})`);
    await bare.mouse.move(400, 500);
    await bare.mouse.move(3, 500, { steps: 6 });
    await bare.waitForTimeout(700);
    const peeked = await taken();
    expect(peeked.length > 0 && peeked.every(Boolean), `and the tabs take the click under the peek too (${peeked.filter(Boolean).length} of ${peeked.length})`);
    await bare.close();
  }
  for (const [width, height] of [[900, 700]] as const) {
    console.log(`\nthe top bar layout, ${width}×${height}`);
    const page = await browser.newPage({ viewport: { width, height } });
    await open(page, "channel-top");
    const over = await page.evaluate(() => (document.scrollingElement?.scrollWidth ?? 0) - innerWidth);
    const strip = await boxOf(page, ".top");
    const tabs = await page.evaluate(() => [...document.querySelectorAll(".rail .tile")].map((tile) => Math.round(tile.getBoundingClientRect().bottom)));
    expect(over <= 0, `nothing scrolls sideways (${over}px over)`);
    expect(!!strip && tabs.length > 0 && tabs.every((bottom) => bottom <= strip.bottom), "the tabs are still one line");
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
      if (shot === "settings-devices") expect(!!back && !!home && home.left >= back.right, `the tabs start after the Settings title (${home?.left} after ${back?.right})`);
      await nothingClashes(page, "here");
      await page.close();
    }
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
