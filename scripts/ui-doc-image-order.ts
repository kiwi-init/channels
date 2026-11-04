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

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-image-order-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

async function paste(page: Page, name: string): Promise<void> {
  await page.evaluate(async (file) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 48;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2d context");
    g.fillStyle = "#3a7";
    g.fillRect(0, 0, 64, 48);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("no png");
    const dt = new DataTransfer();
    dt.items.add(new File([blob], file, { type: "image/png" }));
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, name);
}

interface Seen {
  top: number;
  images: number;
}

const seen = (page: Page, text: string): Promise<Seen | null> =>
  page.evaluate((want) => {
    const pane = document.querySelector(".main");
    if (!pane) return null;
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!n.textContent?.includes(want) || !el || !el.getClientRects().length) continue;
      const row = el.closest(".msg, section.blk, [data-seq]") ?? el;
      return { top: el.getBoundingClientRect().top, images: row.querySelectorAll("img").length };
    }
    return null;
  }, text);

let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(`http://127.0.0.1:${port}/`);
  await firstRun(page, "jow");
  await newChannel(page, "order");
  await page.locator(".thread-doc .doc-tail").last().click();
  await paste(page, "shot.png");
  await page.keyboard.type("a line with an image");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.waitForTimeout(2500);
  await page.keyboard.type("a later line");
  await page.keyboard.press("ControlOrMeta+Enter");
  await page.waitForTimeout(2500);
  const image = await seen(page, "a line with an image");
  const later = await seen(page, "a later line");
  const why = !image
    ? "the image line isn't on screen"
    : !later
      ? "the later line isn't on screen"
      : image.images < 1
        ? "the image line shows no image"
        : image.top >= later.top
          ? `the image line (y=${Math.round(image.top)}) is drawn below the later line (y=${Math.round(later.top)})`
          : null;
  failed = !!why;
  const shot = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);
  if (shot) await page.screenshot({ path: shot });
  console.log(`${why ? "✗" : "✓"} a sent line with an image stays above a line sent after it${why ? `: ${why}` : ""}`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failed) {
  console.error(`a line with an image is drawn out of order, in ${ENGINE}`);
  process.exitCode = 1;
}
