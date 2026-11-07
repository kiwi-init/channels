import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

import { reactionsOn, settleRequests, type Settle } from "./settle-requests.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const engine = flag("--browser") ?? "chromium";
const dist = resolve(flag("--dist") ?? "ui/dist");
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const CPU_SLOWDOWN = 4;
const CATALOG_MS = 4000;
const SHOTS = ["thread-doc-1000", "thread-doc-busy"];
const later = (ms: number) => new Promise((done) => setTimeout(done, ms));
const hung: (() => void)[] = [];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/probe/other.html") return new Response(`<!doctype html><script>fetch("/probe/other.json")</script>`, { headers: { "content-type": "text/html" } });
    if (path === "/probe/other.json") return new Response("{}", { headers: { "content-type": "application/json" } });
    if (path === "/probe/cancel.html")
      return new Response(`<!doctype html><script>fetch("/reactions/index.json").then((r) => r.json()).catch(() => {})</script>`, { headers: { "content-type": "text/html" } });
    if (path === "/probe/hang.html") return new Response(`<!doctype html><script>fetch("/reactions/hang.json").catch(() => {})</script>`, { headers: { "content-type": "text/html" } });
    if (path === "/reactions/hang.json") {
      await new Promise<void>((done) => hung.push(done));
      return new Response("{}");
    }
    if (path === "/reactions/index.json") await later(CATALOG_MS);
    const file = Bun.file(path.startsWith("/reactions/") ? resolve(import.meta.dir, "../site", "." + path) : join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const base = `http://127.0.0.1:${server.port}/`;
const name = engine === "webkit" ? "WebKit" : "Chromium";

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const note = (what: string) => console.log(`  ${what}`);

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

const fresh = async (): Promise<{ page: Page; errors: string[]; settle: Settle; catalogAsked: () => boolean }> => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  if (engine === "chromium") await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let asked = false;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/reactions/index.json") asked = true;
  });
  return { page, errors, settle: settleRequests(page, reactionsOn(base)), catalogAsked: () => asked };
};

type Run = { askedAtIdle: boolean[]; inFlightAtGoto: string[][]; errors: string[] };

const shotLoop = async (wait: boolean): Promise<Run> => {
  const { page, errors, settle, catalogAsked } = await fresh();
  const run: Run = { askedAtIdle: [], inFlightAtGoto: [], errors };
  for (const shot of SHOTS) {
    if (wait) await settle.settled(CATALOG_MS * 3);
    run.inFlightAtGoto.push(settle.inFlight());
    await page.goto(`${base}?shot=${shot}&theme=light`);
    await page.waitForLoadState("networkidle");
    run.askedAtIdle.push(catalogAsked());
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    if (wait) await settle.settled(CATALOG_MS * 3);
    await page.screenshot();
  }
  await page.goto(`${base}probe/other.html`);
  await later(500);
  await page.close();
  return run;
};

try {
  const before = await shotLoop(false);
  note(
    `${name}, the shot loop as it was: catalog asked by networkidle on ${SHOTS[0]}: ${before.askedAtIdle[0]}; in flight when it navigated to ${SHOTS[1]}: ${before.inFlightAtGoto[1]?.join(", ") || "none"}; page errors: ${before.errors.join("; ") || "none"}`,
  );
  if (engine === "chromium") {
    check(before.askedAtIdle[0] === false, `with the CPU ${CPU_SLOWDOWN}x slower, networkidle on ${SHOTS[0]} comes before the app asks for the catalog`);
    check(!!before.inFlightAtGoto[1]?.some((u) => u.endsWith("/reactions/index.json")), `so the old loop navigates to ${SHOTS[1]} with the catalog request still in flight`);
  }

  const after = await shotLoop(true);
  check(
    after.inFlightAtGoto.every((open) => open.length === 0),
    "with the wait, no /reactions/ request is in flight at any navigation",
  );
  check(after.errors.length === 0, `with the wait, no page error is recorded${after.errors.length ? `: ${after.errors.join("; ")}` : ""}`);

  if (engine === "webkit") {
    const { page, errors } = await fresh();
    const asked = page.waitForRequest((r) => r.url().endsWith("/reactions/index.json"));
    await page.goto(`${base}probe/cancel.html`, { waitUntil: "commit" });
    await asked;
    await page.goto(`${base}probe/other.html`);
    await later(500);
    note(`WebKit, leaving a page while its caught catalog fetch is in flight (#1850, seen only now and then): ${errors.join("; ") || "no page error this run"}`);
    await page.close();
  }
  {
    const { page, settle } = await fresh();
    const other = page.waitForResponse((r) => r.url().endsWith("/probe/other.json"));
    await page.goto(`${base}probe/other.html`);
    check((await other).status() === 200 && settle.inFlight().length === 0, "another same-origin request isn't tracked and completes");
    await page.close();
  }
  {
    const { page, settle } = await fresh();
    const asked = page.waitForRequest((r) => r.url().endsWith("/reactions/hang.json"));
    await page.goto(`${base}probe/hang.html`, { waitUntil: "commit" });
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
  console.error(`${failures.length} settle checks failed in ${name}`);
  process.exitCode = 1;
}
