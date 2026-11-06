import { chromium, webkit, type Page } from "playwright-core";

import { reactionsOn, settleRequests } from "./settle-requests.ts";

const engine = process.argv.includes("--browser") ? process.argv[process.argv.indexOf("--browser") + 1] : "chromium";
const SLOW_MS = 600;
const later = (ms: number) => new Promise((done) => setTimeout(done, ms));
const hung: (() => void)[] = [];

const PAGE = `<!doctype html><title>settle</title><script>
fetch("/reactions/index.json").then((r) => r.json()).then(() => (document.title = "catalog"), () => (document.title = "caught"));
fetch("/other.json").then((r) => r.text()).then(() => (document.title += " other"), () => {});
</script>`;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/page.html") return new Response(PAGE, { headers: { "content-type": "text/html" } });
    if (path === "/next.html") return new Response("<!doctype html><title>next</title>", { headers: { "content-type": "text/html" } });
    if (path === "/hang.html") return new Response(`<!doctype html><script>fetch("/reactions/hang.json").catch(() => {})</script>`, { headers: { "content-type": "text/html" } });
    if (path === "/reactions/hang.json") {
      await new Promise<void>((done) => hung.push(done));
      return new Response("{}");
    }
    await later(SLOW_MS);
    return new Response("{}", { headers: { "content-type": "application/json" } });
  },
});
const base = `http://127.0.0.1:${server.port}/`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

const open = async (page: Page) => {
  const catalog = page.waitForRequest((r) => r.url().endsWith("/reactions/index.json"));
  await page.goto(`${base}page.html`, { waitUntil: "commit" });
  await catalog;
};

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
try {
  {
    const page = await browser.newPage();
    const raced: string[] = [];
    page.on("pageerror", (e) => raced.push(e.message));
    const settle = settleRequests(page, reactionsOn(base));
    await open(page);
    const atNavigation = settle.inFlight();
    check(
      atNavigation.some((u) => u.endsWith("/reactions/index.json")),
      "without the wait, the catalog request is still in flight when the next navigation starts",
    );
    check(!atNavigation.some((u) => u.endsWith("/other.json")), "another same-origin request isn't tracked");
    await page.goto(`${base}next.html`);
    await later(SLOW_MS);
    console.log(`  page errors without the wait: ${raced.length ? raced.join("; ") : "none"}`);
    await page.close();
  }
  {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const settle = settleRequests(page, reactionsOn(base));
    const answered = page.waitForResponse((r) => r.url().endsWith("/reactions/index.json"));
    const other = page.waitForResponse((r) => r.url().endsWith("/other.json"));
    await open(page);
    await settle.settled();
    check(settle.inFlight().length === 0, "with the wait, the catalog request has settled before the navigation");
    check((await answered).status() === 200, "the real catalog is served (200)");
    check((await other).status() === 200, "another same-origin request completes untouched");
    await page.goto(`${base}next.html`);
    await later(SLOW_MS);
    check(errors.length === 0, `no page error is recorded${errors.length ? `: ${errors.join("; ")}` : ""}`);
    await page.close();
  }
  {
    const page = await browser.newPage();
    const settle = settleRequests(page, reactionsOn(base));
    const asked = page.waitForRequest((r) => r.url().endsWith("/reactions/hang.json"));
    await page.goto(`${base}hang.html`, { waitUntil: "commit" });
    await asked;
    const stuck = await settle.settled(300).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    check(stuck.includes("/reactions/hang.json"), "a request that never settles fails the wait and names its URL");
    for (const done of hung) done();
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop(true);
}
if (failures.length) {
  console.error(`${failures.length} settle checks failed in ${engine === "webkit" ? "WebKit" : "Chromium"}`);
  process.exitCode = 1;
}
