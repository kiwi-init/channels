#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const ROW = ".gh-row.spec-row";

const nameState = (page: Page, sel: string) =>
  page.evaluate((pick: string) => {
    const el = document.querySelector<HTMLElement>(pick);
    if (!el) return null;
    const style = getComputedStyle(el);
    return { text: el.textContent ?? "", opacity: style.opacity, clip: style.clipPath };
  }, sel);

const waitNamed = (page: Page, sel: string) =>
  page.waitForFunction(
    (pick: string) => {
      const el = document.querySelector<HTMLElement>(pick);
      return !!el && getComputedStyle(el).opacity === "1" && getComputedStyle(el).clipPath === "none";
    },
    sel,
    { timeout: 10_000, polling: "raf" },
  );

async function tabTo(page: Page, sel: string, has: string): Promise<boolean> {
  await page.mouse.move(0, 0);
  const want: [string, string] = [sel, has];
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(([s, h]: [string, string]) => (document.activeElement?.matches(s) && !!document.activeElement.querySelector(h)) ?? false, want)) return true;
  }
  return false;
}

async function run(browser: Browser): Promise<string | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=specs`);
    await page.waitForSelector(`${ROW} .spec-face`, { timeout: 60_000 });
    await page.waitForTimeout(600);

    const stray = await page.evaluate(() => [...document.querySelectorAll(".spec-face")].filter((f) => !f.closest(".spec-card-faces")).length);
    if (stray > 0) return `${stray} named avatars live outside the specs rows and cards`;

    const nested = await page.evaluate(
      (row: string) => [...document.querySelectorAll(`${row}, .spec-card-main`)].flatMap((b) => [...b.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]")]).length,
      ROW,
    );
    if (nested > 0) return `${nested} focusable elements sit inside the row and card buttons`;

    const rest = await nameState(page, `${ROW} .spec-face-name`);
    if (!rest?.text.trim()) return "the row's worker avatar has no name";
    if (rest.opacity !== "0") return `the name tag is visible at rest (opacity ${rest.opacity})`;

    const row = page.locator(ROW).filter({ hasText: "Drafts survive a restart" }).first();
    await row.locator(".spec-face").first().hover();
    try {
      await waitNamed(page, `${ROW} .spec-face-name`);
    } catch {
      const hover = await nameState(page, `${ROW} .spec-face-name`);
      return `hovering a worker avatar leaves its name hidden (opacity ${hover?.opacity}, clip ${hover?.clip})`;
    }

    if (!(await tabTo(page, ROW, ".spec-faces-all"))) return "the Tab key never reaches a specs row";
    try {
      await waitNamed(page, `${ROW} .spec-faces-all`);
    } catch {
      const keyed = await nameState(page, `${ROW} .spec-faces-all`);
      return `keyboard focus on the row leaves the names hidden (opacity ${keyed?.opacity}, clip ${keyed?.clip})`;
    }
    const keyed = await nameState(page, `${ROW} .spec-faces-all`);
    if (!keyed?.text.includes(",")) return `keyboard focus shows one combined line, not each avatar's tag (got "${keyed?.text}")`;
    const single = await nameState(page, `${ROW} .spec-face-name`);
    if (single && single.opacity !== "0") return "keyboard focus on the row reveals the per-avatar tags, which stamp over each other";

    await page.keyboard.press("Enter");
    await page.waitForSelector(".spec-page", { timeout: 10_000 });
    await page.goto(`http://127.0.0.1:${server.port}/?shot=specs`);
    await page.waitForSelector(`${ROW} .spec-face`, { timeout: 60_000 });
    if (!(await tabTo(page, ROW, ".spec-faces-all"))) return "the Tab key never reaches a specs row again";
    await page.keyboard.press(" ");
    await page.waitForSelector(".spec-page", { timeout: 10_000 });

    await page.goto(`http://127.0.0.1:${server.port}/?shot=specs-general`);
    await page.waitForSelector(".spec-card-main .spec-face", { timeout: 60_000 });
    await page.waitForTimeout(600);
    const cardRest = await nameState(page, ".spec-card-main .spec-face-name");
    if (!cardRest?.text.trim()) return "the card's worker avatar has no name";
    if (cardRest.opacity !== "0") return `the card's name tag is visible at rest (opacity ${cardRest.opacity})`;
    await page.locator(".spec-card-main .spec-face").first().hover();
    try {
      await waitNamed(page, ".spec-card-main .spec-face-name");
    } catch {
      const cardHover = await nameState(page, ".spec-card-main .spec-face-name");
      return `hovering a card avatar leaves its name hidden (opacity ${cardHover?.opacity}, clip ${cardHover?.clip})`;
    }
    if (!(await tabTo(page, ".spec-card-main", ".spec-faces-all"))) return "the Tab key never reaches a spec card";
    try {
      await waitNamed(page, ".spec-card-main .spec-faces-all");
    } catch {
      const cardKeyed = await nameState(page, ".spec-card-main .spec-faces-all");
      return `keyboard focus on a card leaves the names hidden (opacity ${cardKeyed?.opacity}, clip ${cardKeyed?.clip})`;
    }
    return null;
  } finally {
    await page.close();
  }
}

const problems: string[] = [];
const one = engine;
const browser = one === "chromium" ? await chromium.launch() : await webkit.launch();
try {
  const bad = await run(browser);
  if (bad) problems.push(`${one}: ${bad}`);
  else console.log(`${one}: specs worker avatars name themselves on hover and keyboard focus, and the rows and cards stay one button`);
} finally {
  await browser.close();
}
server.stop(true);
if (problems.length) {
  for (const p of problems) console.error(`ui-spec-names: ${p}`);
  process.exit(1);
}
