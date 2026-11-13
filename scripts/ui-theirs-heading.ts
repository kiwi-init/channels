import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-theirs-heading.ts [--dist ui/dist] [--browser webkit|chromium]\n\nOthers' direct messages keeps its heading, count and disclosure in place while one of its conversations is open: selecting, switching and leaving move no row, aria-expanded matches what shows, collapsing keeps only the open conversation under the heading, and focus stays on the disclosure (#2386).",
  );
  process.exit(0);
}
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
const browser = await (engine === "webkit" ? webkit : chromium).launch({ executablePath: engine === "chromium" ? process.env.SMOKE_CHROMIUM || undefined : undefined });
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

const GROUP = `section[aria-label="Others' direct messages"]`;
const PAIRS = [
  ["atlas", "win"],
  ["pixel", "ridge"],
  ["lena", "nova"],
  ["orbit", "flint"],
] as const;

interface Group {
  heading: { top: number; expanded: string | null; focused: boolean } | null;
  rows: { label: string; top: number; on: boolean }[];
}

const group = (page: Page): Promise<Group> =>
  page.evaluate((sel) => {
    const section = document.querySelector(sel);
    const side = document.querySelector<HTMLElement>(".side");
    const at = (el: Element) => Math.round(el.getBoundingClientRect().top - (side?.getBoundingClientRect().top ?? 0) + (side?.scrollTop ?? 0));
    const heading = section?.querySelector<HTMLButtonElement>("button[aria-expanded]") ?? null;
    const rows = [...(section?.querySelectorAll<HTMLButtonElement>(".side-row:not([aria-expanded])") ?? [])];
    return {
      heading: heading ? { top: at(heading), expanded: heading.getAttribute("aria-expanded"), focused: document.activeElement === heading } : null,
      rows: rows.map((r) => ({ label: r.textContent?.trim() ?? "", top: at(r), on: r.classList.contains("is-on") })),
    };
  }, GROUP);

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const a of document.getAnimations()) {
      try {
        a.finish();
      } catch {
        // An infinite or already finished animation can't be finished; it moves nothing we measure.
      }
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(250);
}

const pairRow = (page: Page, i: number) => {
  const [a, b] = PAIRS[i]!;
  return page.locator(`${GROUP} .side-row:not([aria-expanded])`).filter({ hasText: a }).filter({ hasText: b }).first();
};
const heading = (page: Page) => page.locator(`${GROUP} button[aria-expanded]`);
const room = (page: Page) => page.locator(".side-row:has(.side-hash)").first();
const has = (g: Group, i: number) => g.rows.some((r) => r.label.includes(PAIRS[i]![0]) && r.label.includes(PAIRS[i]![1]));
const onRow = (g: Group): number => g.rows.findIndex((r) => r.on);
const tops = (g: Group) => JSON.stringify([g.heading?.top, ...g.rows.map((r) => r.top)]);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=theirs-many`);
  await page.locator(GROUP).waitFor();
  await settle(page);

  let g = await group(page);
  expect(g.heading?.expanded === "false" && g.rows.length === 0, `collapsed at the start: heading ${g.heading ? "shown" : "missing"}, aria-expanded ${g.heading?.expanded}, ${g.rows.length} rows`);

  await heading(page).click();
  await settle(page);
  const expanded = await group(page);
  expect(
    expanded.heading?.expanded === "true" && expanded.rows.length === PAIRS.length,
    `expanding shows all ${PAIRS.length} conversations under aria-expanded true (${expanded.rows.length}, ${expanded.heading?.expanded})`,
  );
  expect(!!expanded.heading?.focused, "focus stays on the disclosure after expanding");
  await page.keyboard.press("Tab");
  expect(await pairRow(page, 0).evaluate((el) => el === document.activeElement), "Tab moves from the disclosure to the first conversation");

  await pairRow(page, 1).click();
  await settle(page);
  g = await group(page);
  expect(!!g.heading, "selecting a conversation keeps the heading");
  expect(g.heading?.expanded === "true" && g.rows.length === PAIRS.length, `selecting keeps the list expanded and aria-expanded true (${g.heading?.expanded}, ${g.rows.length} rows)`);
  expect(tops(g) === tops(expanded), `selecting moves nothing: ${tops(g)} vs ${tops(expanded)}`);
  expect(onRow(g) === 1, "the selected conversation is the active row");

  await pairRow(page, 2).click();
  await settle(page);
  g = await group(page);
  expect(!!g.heading && tops(g) === tops(expanded), `switching conversations keeps the heading and moves nothing: ${tops(g)}`);
  expect(onRow(g) === 2 && g.rows.filter((r) => r.on).length === 1, "switching moves the active row only");

  await room(page).click();
  await settle(page);
  g = await group(page);
  expect(!!g.heading && tops(g) === tops(expanded), `back in a room the heading and rows stay put: ${tops(g)}`);
  expect(onRow(g) === -1, "back in a room no conversation is active");

  await pairRow(page, 3).click();
  await settle(page);
  await heading(page).focus();
  await page.keyboard.press("Enter");
  await settle(page);
  g = await group(page);
  expect(g.heading?.expanded === "false", `collapsing with a conversation open sets aria-expanded false (${g.heading?.expanded})`);
  expect(g.rows.length === 1 && has(g, 3) && onRow(g) === 0, `collapsed, only the open conversation stays under the heading (${g.rows.map((r) => r.label).join(", ")})`);
  expect(g.heading?.top === expanded.heading?.top, `collapsing leaves the heading in place (${g.heading?.top} vs ${expanded.heading?.top})`);
  expect(!!g.heading?.focused, "focus stays on the disclosure after collapsing with the keyboard");

  await room(page).click();
  await settle(page);
  g = await group(page);
  expect(g.heading?.expanded === "false" && g.rows.length === 0, `leaving for a room while collapsed leaves no stale row (${g.rows.length} rows)`);

  await page.locator(".top-history").getByRole("button", { name: "Back", exact: true }).click();
  await settle(page);
  g = await group(page);
  expect(
    g.heading?.expanded === "false" && g.rows.length === 1 && has(g, 3) && onRow(g) === 0,
    `Back, from outside the sidebar, opens the conversation under the collapsed heading (${g.heading?.expanded}, ${g.rows.map((r) => r.label).join(", ")})`,
  );

  await page.locator(".top-history").getByRole("button", { name: "Back", exact: true }).click();
  await settle(page);
  g = await group(page);
  expect(g.heading?.expanded === "false" && g.rows.length === 0, `Back again, to the room, leaves no stale row (${g.rows.length} rows)`);

  await page.locator(".top-history").getByRole("button", { name: "Back", exact: true }).click();
  await settle(page);
  g = await group(page);
  expect(
    g.heading?.expanded === "false" && g.rows.length === 1 && has(g, 2) && onRow(g) === 0,
    `Back once more switches to the earlier conversation with no stale row left (${g.rows.map((r) => r.label).join(", ")})`,
  );

  await heading(page).click();
  await settle(page);
  g = await group(page);
  expect(g.heading?.expanded === "true" && tops(g) === tops(expanded) && onRow(g) === 2, `expanding again restores every row in place with the open one active: ${tops(g)}`);
} finally {
  await browser.close();
  server.stop(true);
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `  ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nall ok");
