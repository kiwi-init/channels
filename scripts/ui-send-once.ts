#!/usr/bin/env bun
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { docOpen, firstRun, newChannel, say } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const OFFLINE = "written while the relay was away";
const AGAIN = "written in a second outage";
const UNSURE = "stored, but every answer was lost";

const data = mkdtempSync(join(tmpdir(), "kiwi-send-once-"));
mkdirSync(join(data, "relay"));
const first = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const port = first.port;
let relay = first.relay;
const BASE = `http://127.0.0.1:${port}/`;
const browser = await (
  ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined, args: ["--disable-features=LocalNetworkAccessChecks"] })
).catch((err: unknown) => {
  relay.kill();
  throw err;
});

const failures: string[] = [];
const said: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  if (why)
    console.log(
      `  the page's last lines at ${new Date().toISOString().slice(11, 19)}:\n${said
        .slice(-40)
        .map((l) => `    ${l}`)
        .join("\n")}`,
    );
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

const rows = (page: Page, text: string) => page.locator(".main article.msg", { hasText: text });
const failed = (page: Page, text: string) => rows(page, text).locator(".msg-failed");

async function settled(page: Page, text: string, ms: number): Promise<{ rows: number; failed: number }> {
  const end = Date.now() + ms;
  let last = { rows: -1, failed: -1 };
  let since = Date.now();
  while (Date.now() < end) {
    const now = { rows: await rows(page, text).count(), failed: await failed(page, text).count() };
    if (now.rows !== last.rows || now.failed !== last.failed) since = Date.now();
    last = now;
    if (now.rows === 1 && now.failed === 0 && Date.now() - since > 3000) return now;
    await page.waitForTimeout(250);
  }
  return last;
}

function fromDisk(path: string): string | null {
  const file = join(DIST, normalize(path === "/" || !path.includes(".") ? "index.html" : path));
  return file.startsWith(DIST) && existsSync(file) && statSync(file).isFile() ? file : null;
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let down = false;
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const file = down && req.method() === "GET" && !url.pathname.startsWith("/v1/") ? fromDisk(decodeURIComponent(url.pathname)) : null;
    if (file) return route.fulfill({ path: file });
    return route.continue();
  });
  let lost = false;
  let lostPosts = 0;
  await context.route("**/messages", async (route) => {
    if (!lost || route.request().method() !== "POST") return route.fallback();
    lostPosts += 1;
    return route.abort("connectionreset");
  });
  await context.routeWebSocket(/\/ws\?/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => server.send(m));
    server.onMessage((m) => {
      if (lost && typeof m === "string" && m.includes('"t":"ack"')) return;
      ws.send(m);
    });
  });
  const page = await context.newPage();
  const threw: string[] = [];
  await pageErrors(page, (e) => threw.push(e));
  page.on("console", (m) => void said.push(`${new Date().toISOString().slice(11, 19)} [${m.type()}] ${m.text().slice(0, 220)}`));
  page.on("requestfailed", (r) => void said.push(`${new Date().toISOString().slice(11, 19)} [request failed] ${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));
  await page.goto(BASE);
  await firstRun(page, "owner");
  await newChannel(page, "send once");
  await say(page, "sent while all was well");
  await rows(page, "sent while all was well").first().waitFor({ timeout: 30000 });

  await settled(page, "sent while all was well", 30_000);
  lost = true;
  await say(page, UNSURE);
  const lostBy = Date.now() + 120_000;
  while (lostPosts < 3 && Date.now() < lostBy) await page.waitForTimeout(250);
  check("the relay stored a message whose every answer was lost", lostPosts >= 3 ? null : `only ${lostPosts} lost answers in 120 s`);
  await page.waitForTimeout(5000);
  lost = false;
  const unsure = await settled(page, UNSURE, 60_000);
  check("it shows once with no Couldn't send, and is not sent again", unsure.rows === 1 && unsure.failed === 0 ? null : `${unsure.rows} rows, ${unsure.failed} failed`);
  const left = await page.locator(".main .composer textarea").first().inputValue();
  check("nothing came back into the composer", left === "" ? null : `it holds "${left}"`);

  down = true;
  relay.kill();
  await new Promise((done) => relay.once("exit", done));
  await say(page, OFFLINE);
  await failed(page, OFFLINE).first().waitFor({ timeout: 90_000 });
  check("with the relay away the message says Couldn't send", (await rows(page, OFFLINE).count()) === 1 ? null : `${await rows(page, OFFLINE).count()} rows`);

  await page.reload();
  await docOpen(page);
  const kept = await failed(page, OFFLINE)
    .first()
    .waitFor({ timeout: 30_000 })
    .then(
      () => true,
      () => false,
    );
  check("after a reload with the relay still away the failed message is still there", kept ? null : "it was gone");

  ({ relay } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false, port }));
  down = false;
  const backAt = Date.now();
  const back = await settled(page, OFFLINE, 180_000);
  console.log(`  ${Math.round((Date.now() - backAt) / 1000)} s after the relay came back`);
  check("when the relay is back the message sends itself, once", back.rows === 1 && back.failed === 0 ? null : `${back.rows} rows, ${back.failed} failed`);

  down = true;
  relay.kill();
  await new Promise((done) => relay.once("exit", done));
  await say(page, AGAIN);
  await failed(page, AGAIN).first().waitFor({ timeout: 90_000 });
  ({ relay } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false, port }));
  down = false;
  const openAt = Date.now();
  const open = await settled(page, AGAIN, 180_000);
  console.log(`  ${Math.round((Date.now() - openAt) / 1000)} s after the relay came back`);
  check("with the app left open through a second outage, that message sends itself too, once", open.rows === 1 && open.failed === 0 ? null : `${open.rows} rows, ${open.failed} failed`);

  await page.reload();
  await docOpen(page);
  await rows(page, "sent while all was well").first().waitFor({ timeout: 30000 });
  for (const text of ["sent while all was well", UNSURE, OFFLINE, AGAIN]) {
    const after = await settled(page, text, 15_000);
    check(`the relay holds "${text}" once`, after.rows === 1 && after.failed === 0 ? null : `${after.rows} rows, ${after.failed} failed`);
  }
  check("the page never threw", threw.length ? threw.join("; ") : null);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nsend once: ok");
