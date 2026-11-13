import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

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

const BACK = "Back";
const FORWARD = "Forward";

const place = (page: Page) =>
  page.evaluate(() => {
    if (document.querySelector(".set")) return "settings";
    if (document.querySelector(".home-area, .home-main")) return "home";
    if (document.querySelector(".spec-doc-wrap")) return "spec";
    const box = document.querySelector<HTMLTextAreaElement>(".main .composer textarea");
    if (box) return box.getAttribute("placeholder") ?? "a room";
    if (document.querySelector(".main :is(.gh-rows, .spec-card-main, .board)")) return "specs";
    return "unknown";
  });

const feedTop = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".main *")].find((el) => el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY))?.scrollTop ?? -1);

const arrows = (page: Page) =>
  page.evaluate(() => {
    const [back, forward] = [...document.querySelectorAll<HTMLButtonElement>(".top-history button")];
    return { count: document.querySelectorAll(".top-history").length, back: back ? !back.disabled : null, forward: forward ? !forward.disabled : null };
  });

const arrow = (page: Page, name: string) => page.locator(".top-history").getByRole("button", { name, exact: true });

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(500);
}

async function open(width: number, height: number, init?: () => void): Promise<Page> {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  if (init) await page.addInitScript(init);
  return page;
}

try {
  const page = await open(1440, 900);
  await page.goto(`http://127.0.0.1:${server.port}/?shot=specs-general`);
  await page.locator(".top-history").first().waitFor();
  await settle(page);
  const start = await place(page);
  expect((await arrows(page)).count === 1, `a channel shows one pair of arrows (at ${start})`);
  expect(!!(await arrow(page, BACK).getAttribute("title"))?.includes("["), "Back's tooltip names its shortcut");
  expect(!!(await arrow(page, FORWARD).getAttribute("title"))?.includes("]"), "Forward's tooltip names its shortcut");

  const scrolled = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".main *")].find((e) => e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (!el) return -1;
    el.scrollTo(0, Math.round((el.scrollHeight - el.clientHeight) / 3));
    return el.scrollTop;
  });
  expect(scrolled > 0, `the ${start} conversation scrolls to ${scrolled}px from its top`);
  await page.waitForTimeout(400);
  const startTop = await feedTop(page);

  await page.locator(".side-row", { hasText: "design" }).first().click();
  await settle(page);
  const design = await place(page);

  await page.locator(".side-row", { hasText: "Specs" }).first().click();
  await settle(page);
  await page.locator(".gh-row.spec-row, .spec-card-main, .board-row").first().click();
  await settle(page);
  expect((await place(page)) === "spec", "a spec opens");

  await page.locator(".rail-gear").click();
  await settle(page);
  expect((await place(page)) === "settings" && (await arrows(page)).count === 1, "Settings shows the arrows");

  await page.locator(".tile.is-home").first().click();
  await settle(page);
  expect((await place(page)) === "home" && (await arrows(page)).count === 1, "Home shows the arrows");
  expect((await arrows(page)).forward === false, "at the newest place Forward is off");

  const walk: string[] = [];
  for (let i = 0; i < 5; i++) {
    await arrow(page, BACK).click();
    await settle(page);
    walk.push(await place(page));
  }
  expect(walk.join(" > ") === `settings > spec > specs > ${design} > ${start}`, `Back walks Home > ${walk.join(" > ")}`);
  const backTop = await feedTop(page);
  expect(backTop > 0 && Math.abs(backTop - startTop) <= 24, `back in ${start} the conversation is where it was (${backTop}px vs ${startTop}px)`);
  expect((await arrows(page)).forward === true, "after Back, Forward is on");

  await arrow(page, FORWARD).click();
  await settle(page);
  expect((await place(page)) === design, "Forward goes one step ahead again");
  await page.keyboard.press(engine === "webkit" ? "Meta+BracketLeft" : "Control+BracketLeft");
  await settle(page);
  const byKey = await place(page);
  await arrow(page, FORWARD).click();
  await settle(page);
  await arrow(page, BACK).click();
  await settle(page);
  expect(byKey === start && (await place(page)) === start, "the keyboard's Back and the arrow land on the same place");

  await page.locator(".side-row", { hasText: "releases" }).first().click();
  await settle(page);
  expect((await arrows(page)).forward === false, "going somewhere new after Back turns Forward off");
  await page.close();

  const home = await open(1440, 900);
  await home.goto(`http://127.0.0.1:${server.port}/?shot=home`);
  await home.locator(".top-history").first().waitFor();
  await settle(home);
  const fresh = await arrows(home);
  expect(fresh.back === false && fresh.forward === false, "a fresh window on Home has both arrows off");
  await home.close();

  const empty = await open(1440, 900);
  await empty.goto(`http://127.0.0.1:${server.port}/?shot=welcome`);
  await empty.locator(".top-history").first().waitFor();
  await settle(empty);
  expect((await place(empty)) === "home" || (await empty.locator(".start-area").count()) > 0, "Home with no channels shows the arrows");
  await empty.locator(".rail-gear").click();
  await settle(empty);
  expect((await place(empty)) === "settings", "from Home with no channels, Settings opens");
  await arrow(empty, BACK).click();
  await settle(empty);
  expect((await empty.locator(".start-area").count()) === 1 && (await empty.locator(".top-history").count()) === 1, "Back from Settings lands on Home with no channels, arrows and all");
  await arrow(empty, FORWARD).click();
  await settle(empty);
  expect((await place(empty)) === "settings", "and Forward returns to Settings");
  await empty.close();

  const modal = await open(1440, 900);
  await modal.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  await modal.locator(".top-history").first().waitFor();
  await settle(modal);
  await modal.locator(".side-row", { hasText: "jow" }).first().click();
  await modal.locator("dialog[open]").first().waitFor();
  const open1 = await arrows(modal);
  expect(open1.back === true && open1.forward === true, "with a modal open both arrows are on, Forward too with nothing ahead");
  const before = await place(modal);
  await arrow(modal, FORWARD).click({ force: true });
  await settle(modal);
  expect((await modal.locator("dialog[open]").count()) === 0 && (await place(modal)) === before, "Forward with a modal open closes it and stays put");
  await modal.close();

  const sizes = [
    { width: 640, height: 480 },
    { width: 760, height: 560 },
    { width: 761, height: 560 },
    { width: 1179, height: 800 },
    { width: 1180, height: 800 },
    { width: 1440, height: 900 },
    { width: 760, height: 1000 },
  ];
  const looks: { name: string; init?: () => void; left: number }[] = [
    { name: "plain", left: 0 },
    { name: "mac", init: () => document.addEventListener("DOMContentLoaded", () => (document.documentElement.dataset["shell"] = "mac")), left: 64 + 16 },
    { name: "floating Linux", init: () => document.addEventListener("DOMContentLoaded", () => (document.documentElement.dataset["wm"] = "floating")), left: 0 },
  ];
  for (const look of looks) {
    for (const size of sizes) {
      for (const shot of ["channel", "settings", "home"]) {
        const p = await open(size.width, size.height, look.init);
        await p.goto(`http://127.0.0.1:${server.port}/?shot=${shot}`);
        await p.locator(".top-history").first().waitFor();
        await settle(p);
        const found = await p.evaluate(() => {
          const box = document.querySelector(".top-history");
          if (!box) return null;
          const r = box.getBoundingClientRect();
          const name = (el: Element) =>
            `${el.tagName.toLowerCase()}.${String(el.getAttribute("class") ?? "")
              .trim()
              .split(/\s+/)
              .join(".")}`;
          const hit = (o: DOMRect) => o.width > 0 && o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top;
          const others = [...document.querySelectorAll(".top-tools > *, .rail .tile, .top-here, .top-drawer, .set-top-title, .wm-controls, .top-find")].filter(
            (el) => !box.contains(el) && hit(el.getBoundingClientRect()),
          );
          const region = (b: Element) => {
            const c = b.getBoundingClientRect();
            for (let el = document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2); el; el = el.parentElement) {
              const v = getComputedStyle(el).getPropertyValue("-webkit-app-region").trim();
              if (v === "drag" || v === "no-drag") return v;
            }
            return "-";
          };
          const onTop = [...box.querySelectorAll("button")].every((b) => {
            const c = b.getBoundingClientRect();
            return b.contains(document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2));
          });
          return { left: r.left, top: r.top, overlaps: others.map(name), regions: [...box.querySelectorAll("button")].map(region), onTop };
        });
        const where = `${look.name} ${size.width}x${size.height} ${shot}`;
        if (!found) {
          expect(false, `${where}: no arrows`);
        } else {
          expect(
            found.overlaps.length === 0 && found.onTop && found.left >= look.left && found.top < 60 && !found.regions.includes("drag"),
            `${where}: the arrows are clear and clickable at ${Math.round(found.left)},${Math.round(found.top)}${found.overlaps.length ? `, overlapping ${found.overlaps.join(", ")}` : ""}${found.onTop ? "" : ", covered"}${found.regions.includes("drag") ? ", in a drag region" : ""}`,
          );
        }
        await p.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
