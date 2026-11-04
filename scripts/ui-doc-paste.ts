#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { firstRun, newChannel } from "./perf-ui.ts";

const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const SEND = process.argv.find((a) => a.startsWith("--send-key="))?.slice(11) ?? "ControlOrMeta+Enter";
const UPLOAD_MS = Number(process.argv.find((a) => a.startsWith("--upload-ms="))?.slice(12) ?? 3000);

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-paste-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

async function paste(page: Page, name: string): Promise<void> {
  await page.evaluate(async (file) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#3a7";
    g.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob>((done) => canvas.toBlob((b) => done(b!), "image/png"));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], file, { type: "image/png" }));
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, name);
}

interface Line {
  author: string;
  posted: boolean;
  images: number;
  text: string;
}

async function lines(page: Page): Promise<Line[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".thread-doc section.blk")].map((s) => {
      const n = (s as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } }).pmViewDesc?.node;
      return { author: String(n?.attrs.author ?? ""), posted: !!(n?.attrs.posted || n?.attrs.sent), images: s.querySelectorAll("img").length, text: n?.textContent ?? "" };
    }),
  );
}

let failed = 0;
async function scenario(page: Page, what: string, steps: (text: string) => Promise<void>, text: string): Promise<void> {
  await page.locator(".thread-doc .doc-tail").last().click();
  await steps(text);
  await page.waitForTimeout(UPLOAD_MS + 3000);
  const all = await lines(page);
  const line = all.find((l) => l.text.replace(/\[image: [^\]]*\]/g, "").includes(text));
  const left = all.filter((l) => l.author === "jow" && !l.posted && l.images > 0);
  const why = !line
    ? "the line is gone"
    : !line.posted
      ? "the line wasn't sent"
      : line.images !== 1
        ? `the sent line has ${line.images} images`
        : left.length
          ? `${left.length} image line(s) left behind as a draft`
          : null;
  if (why) failed++;
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ": the image went out with its line"}`);
  if (why || process.env.PASTE_DEBUG) for (const l of all.slice(-6)) console.log(`    ${l.author} ${l.posted ? "sent" : "draft"} ${l.images} img ${JSON.stringify(l.text)}`);
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await firstRun(page, "jow");
  await newChannel(page, "paste");
  await page.locator(".thread-doc .ProseMirror").first().waitFor({ timeout: 30000 });
  await page.route("**/*", async (route) => {
    const body = route.request().postDataBuffer();
    if (route.request().method() !== "GET" && body && body.length > 400) await new Promise((r) => setTimeout(r, UPLOAD_MS));
    await route.continue();
  });
  await scenario(
    page,
    `paste an image, type, send at once (upload takes ${UPLOAD_MS} ms)`,
    async (text) => {
      await paste(page, "first.png");
      await page.keyboard.type(text);
      await page.keyboard.press(SEND);
    },
    "Album viu essa imagem ?",
  );
  await scenario(
    page,
    `type, paste an image, send at once (upload takes ${UPLOAD_MS} ms)`,
    async (text) => {
      await page.keyboard.type(text);
      await paste(page, "second.png");
      await page.keyboard.press(SEND);
    },
    "e essa aqui ?",
  );
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failed) {
  console.error(`${failed} pasted images didn't go out with their line, in ${ENGINE}`);
  process.exitCode = 1;
}
