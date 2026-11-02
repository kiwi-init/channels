import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const flag = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};
const dist = resolve(flag("--dist") ?? join(import.meta.dir, "../ui/dist"));
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const CLICKABLE = "button, input, textarea, select, a[href], [role=option], [role=button], [role=tab], [tabindex]";

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
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => fails.push(`page threw: ${e.message}`));
  await page.goto(`http://127.0.0.1:${server.port}/?shot=channel`);
  const top = page.locator(".top");
  await top.waitFor();
  await page.getByRole("button", { name: /Search this channel/ }).click();
  await page.locator(".top-find input").fill("the");
  await page.locator(".search-pop [role=option]").first().waitFor();

  const regions = await top.evaluate((bar, selector) => {
    const dragsWindow = (start: Element): boolean => {
      let found = false;
      for (let el: Element | null = start; el; el = el.parentElement) {
        const region = getComputedStyle(el).getPropertyValue("-webkit-app-region").trim();
        if (region === "no-drag") return false;
        if (region === "drag") found = true;
      }
      return found;
    };
    const name = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    return {
      bar: dragsWindow(bar),
      options: bar.querySelectorAll("[role=option]").length,
      dragging: [...bar.querySelectorAll(selector)].filter(dragsWindow).map(name),
    };
  }, CLICKABLE);

  expect(regions.bar, "the top bar's own background still moves the window");
  expect(regions.options > 0, `search shows results inside the top bar (${regions.options})`);
  expect(regions.dragging.length === 0, `nothing clickable in the top bar starts a window move${regions.dragging.length ? `: ${regions.dragging.join(", ")}` : ""}`);
} finally {
  await browser.close();
  server.stop(true);
}
if (fails.length) {
  console.error(`\n${fails.length} failed`);
  process.exit(1);
}
