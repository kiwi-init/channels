import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { pageErrors } from "./page-errors.ts";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
if (process.argv.includes("--help")) {
  console.log(
    "usage: bun scripts/ui-kept-specs.ts [--dist ui/dist] [--browser webkit|chromium]\n\nThe Specs list stays mounted once opened (#2513): going back to it mounts nothing, it shows what changed while it was away on its first frame, while hidden it is out of sight and out of the tab order, and it comes back as a fresh visit would (the Open list, its first page).",
  );
  process.exit(0);
}
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = flag("--browser") ?? "webkit";
if (engine !== "webkit" && engine !== "chromium") throw new Error(`--browser is webkit or chromium, not ${engine}`);

const AWAY_MS = 2_000;
const LIST = ".page.is-specs";

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

interface Entered {
  added: number;
  same: boolean;
  pass: number;
  shown: boolean;
  open: boolean;
}

const passOf = (text: string | null | undefined): number => Number(/pass (\d+)/.exec(text ?? "")?.[1] ?? -1);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pageErrors(page, (e) => fails.push(`page threw: ${e}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=specs-live`);
  const specs = page
    .getByRole("button", { name: "Specs", exact: true })
    .or(page.getByRole("link", { name: "Specs", exact: true }))
    .first();
  const general = page.getByText("general", { exact: true }).first();
  await specs.click();
  await page.locator(LIST).waitFor();
  await page.waitForFunction((sel) => /pass \d+/.test(document.querySelector(sel)?.textContent ?? ""), LIST);
  const before = passOf(await page.locator(LIST).textContent());
  await page.locator(`${LIST} button[aria-pressed]`, { hasText: "Done" }).click();
  await page.locator(`${LIST} button[aria-pressed="true"]`, { hasText: "Done" }).waitFor();
  await page.evaluate((sel) => document.querySelector(sel)?.setAttribute("data-probe", "first"), LIST);

  await general.click();
  await page.getByPlaceholder("Message #general").waitFor();
  await page.waitForTimeout(300);
  const away = await page.evaluate((sel) => {
    const list = document.querySelector<HTMLElement>(sel);
    const link = list?.querySelector<HTMLElement>("a[href], button");
    link?.focus();
    return {
      kept: !!list && list.getAttribute("data-probe") === "first",
      hidden: !!list && list.getClientRects().length === 0,
      focusable: !!link && document.activeElement === link,
    };
  }, LIST);
  expect(away.kept, "leaving the Specs list keeps it mounted");
  expect(away.hidden, "the kept list is out of sight while #general shows");
  expect(!away.focusable, "a control on the kept list can't take focus while it's hidden");

  await page.waitForTimeout(AWAY_MS);
  const back = await page.evaluate(async (sel): Promise<Entered> => {
    let added = 0;
    const size = (n: Node) => (n.nodeType === 1 ? 1 + (n as Element).querySelectorAll("*").length : 0);
    const watch = new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if ((n as Element).classList?.contains("page")) added += size(n);
    });
    watch.observe(document.body, { childList: true, subtree: true });
    const button = [...document.querySelectorAll<HTMLElement>("button, a")].find((b) => b.textContent?.trim() === "Specs" || b.getAttribute("aria-label") === "Specs");
    button?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    watch.disconnect();
    const list = document.querySelector<HTMLElement>(sel);
    const on = list?.querySelector('button[aria-pressed="true"]')?.textContent ?? "";
    return {
      added,
      same: list?.getAttribute("data-probe") === "first",
      pass: Number(/pass (\d+)/.exec(list?.textContent ?? "")?.[1] ?? -1),
      shown: !!list && list.getClientRects().length > 0,
      open: on.trim().startsWith("Open"),
    };
  }, LIST);
  expect(back.shown && back.same, "going back shows the same list, not a new one");
  expect(back.added === 0, `going back mounts no new page (${back.added} elements added)`);
  expect(
    back.pass > before + 1,
    `on its first frame back, the list shows the task renamed while it was away (pass ${before} when it left, pass ${back.pass} now, about ${Math.round(AWAY_MS / 700)} renames later)`,
  );
  expect(back.open, "it comes back on Open, as a fresh visit does, though Done was chosen before leaving");

  await page.waitForTimeout(1_500);
  const live = passOf(await page.locator(LIST).textContent());
  expect(live > back.pass, `shown again, it keeps updating (pass ${back.pass}, then ${live})`);
  await page.close();
} finally {
  await browser.close();
  await server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed in ${engine}`);
  process.exit(1);
}
console.log(`\nthe Specs list stays mounted and live across tab switches, in ${engine}`);
