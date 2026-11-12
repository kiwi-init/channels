#!/usr/bin/env bun
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Locator, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel, SEND } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`A Retina screenshot posted in chat shows from a copy sized to its box (360 CSS px in the feed, 480 in the thread doc, at
twice the pixels), while the viewer, Save image and a drag still get the full original. With --memory=N it posts N such
shots instead, scrolls past them all and prints the page's memory (macOS WebKit: its WebContent and GPU processes); run
it once with --dist= pointing at a build of main and once at this one to compare.

  bun scripts/ui-image-thumbs.ts [--webkit] [--dist=ui/dist-harness] [--memory=13]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const MEMORY = Number(process.argv.find((a) => a.startsWith("--memory="))?.slice(9) ?? 0);
const WIDTH = 3232;
const HEIGHT = 2148;
const SCALE = 2;
const FEED = 360;

const data = mkdtempSync(join(tmpdir(), "kiwi-image-thumbs-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
writeFileSync(join(cli, "bin", "open"), "#!/bin/sh\nexit 0\n");
writeFileSync(join(cli, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n");
chmodSync(join(cli, "bin", "open"), 0o755);
chmodSync(join(cli, "bin", "xdg-open"), 0o755);
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim()}`)))));
};

const ours = (): Set<string> => new Set(spawnSync("pgrep", ["-f", "ms-playwright/webkit-.*(WebContent|GPU)"]).stdout.toString().trim().split("\n").filter(Boolean));
const footprintMb = (pid: string): number => {
  const m = /phys_footprint:\s*([\d.]+)\s*(KB|MB|GB)/.exec(spawnSync("footprint", [pid]).stdout.toString());
  if (!m) return 0;
  const v = Number(m[1]);
  return m[2] === "GB" ? v * 1024 : m[2] === "KB" ? v / 1024 : v;
};

const before = process.platform === "darwin" && ENGINE === "webkit" ? ours() : new Set<string>();
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

async function screenshotPng(page: Page, label: string): Promise<string> {
  return page.evaluate(
    async ({ width, height, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext("2d");
      if (!g) throw new Error("no 2d context");
      g.fillStyle = "#0c0c0d";
      g.fillRect(0, 0, width, height);
      g.fillStyle = "#18181a";
      g.fillRect(0, 0, 480, height);
      g.font = "28px sans-serif";
      for (let i = 0; i < 6; i++) {
        g.fillStyle = i % 5 === 0 ? "#8ab4ff" : "#a3a3ab";
        g.fillText(`${label} · line ${i}: the build is green`, 520, 120 + i * 320);
        g.fillText(`room-${i}`, 40, 120 + i * 320);
      }
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      if (!blob) throw new Error("no png");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { width: WIDTH, height: HEIGHT, label },
  );
}

async function pasteInto(page: Page, png: string): Promise<void> {
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "pasted-shot.png", { type: "image/png" }));
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png);
}

interface Shown {
  src: string;
  natural: number;
  width: number;
  full: { src: string; natural: number; opacity: string; same: boolean } | null;
}

const shownIn = (button: Locator): Promise<Shown> =>
  button.evaluate(async (el) => {
    const [pic, full] = [...el.querySelectorAll("img")];
    if (!pic) throw new Error("no image in the button");
    await pic.decode().catch(() => undefined);
    const box = pic.getBoundingClientRect();
    const fullBox = full?.getBoundingClientRect();
    return {
      src: pic.src,
      natural: pic.naturalWidth,
      width: Math.round(box.width),
      full: full
        ? {
            src: full.src,
            natural: full.naturalWidth,
            opacity: getComputedStyle(full).opacity,
            same: !!fullBox && Math.abs(fullBox.left - box.left) < 1 && Math.abs(fullBox.top - box.top) < 1 && Math.abs(fullBox.width - box.width) < 1 && Math.abs(fullBox.height - box.height) < 1,
          }
        : null,
    };
  });

let closing = false;
const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

const copyOf = (src: string, original: string): boolean => src.startsWith("data:image/png;base64,") && src !== original;

function feedCopy(shown: Shown, original: string): string | null {
  if (!copyOf(shown.src, original)) return `the feed shows ${shown.src.slice(0, 40)}…, not a copy`;
  if (shown.natural !== FEED * SCALE) return `the copy is ${shown.natural} px wide, not ${FEED * SCALE}`;
  if (shown.width !== FEED) return `it's laid out ${shown.width} px wide, not ${FEED}`;
  if (!shown.full) return "there's no full image over it for a drag or the menu";
  if (shown.full.src !== original) return "the full image over it isn't the one posted";
  if (shown.full.natural !== WIDTH) return `the full image is ${shown.full.natural} px wide, not ${WIDTH}`;
  if (shown.full.opacity !== "0") return `the full image shows (opacity ${shown.full.opacity})`;
  if (!shown.full.same) return "the full image doesn't sit exactly over the copy";
  return null;
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCALE, acceptDownloads: true });
  const errors: string[] = [];
  await pageErrors(page, (e) => errors.push(e));
  page.on("crash", () => errors.push("the page crashed"));
  browser.on("disconnected", () => void (closing || console.error("the browser went away")));
  await page.addInitScript(() => {
    const Real = window.Worker;
    const count = { made: 0, failed: 0 };
    (window as unknown as { thumbWorker: typeof count }).thumbWorker = count;
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes("thumb-worker")) return;
        this.addEventListener("message", (e: MessageEvent<{ thumb?: string | null; failed?: string }>) => {
          if (e.data.failed) count.failed++;
          else if (e.data.thumb) count.made++;
        });
      }
    };
  });
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "thumbs");
  let botIn = false;
  const joining = kiwi(["join", code, "thumbs", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(page, () => !botIn);
  await joining;

  if (MEMORY > 0) {
    for (let i = 0; i < MEMORY; i++) {
      const file = join(data, `shot-${i}.png`);
      writeFileSync(file, Buffer.from(await screenshotPng(page, `shot ${i}`), "base64"));
      await kiwi(["-c", "thumbs", "--as", "bot", "send", "--to", "#general", `retina shot ${i}`, "--image", file]);
    }
    const buttons = page.locator(".main .msg-image");
    await buttons.nth(MEMORY - 1).waitFor({ timeout: 60000 });
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < MEMORY; i++) {
        await buttons.nth(i).scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
      }
    await page.waitForTimeout(4000);
    const pids = [...ours()].filter((p) => !before.has(p));
    const each = pids.map((p) => `${spawnSync("ps", ["-o", "comm=", "-p", p]).stdout.toString().trim().split(".").at(-2) ?? p} ${footprintMb(p).toFixed(0)} MB`);
    const total = pids.reduce((sum, p) => sum + footprintMb(p), 0);
    console.log(`${MEMORY} shots of ${WIDTH}×${HEIGHT} shown, ${ENGINE} ${DIST}: ${pids.length ? `${total.toFixed(0)} MB (${each.join(", ")})` : "no WebKit processes to measure on this system"}`);
  } else {
    const feed = page.locator(".main article.msg .msg-image");
    const png = await screenshotPng(page, "sent");
    check(`the shot is ${WIDTH}×${HEIGHT} and under the image cap`, png.length * 0.75 > 256 * 1024 ? `it's ${Math.round((png.length * 0.75) / 1024)} KB` : null);
    await composer(page).click();
    await pasteInto(page, png);
    await page.locator(".composer .compose-file").first().waitFor({ timeout: 10000 });
    await page.keyboard.type("a line with a retina shot");
    await page.keyboard.press(SEND);
    const button = feed.first();
    await button.waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    const sent = await shownIn(button);
    const original = sent.full?.src ?? `data:image/png;base64,${png}`;
    check("a Retina shot sent from the composer shows in the feed from a copy at 2× its 360 px box, with the original over it", feedCopy(sent, original));
    const inDoc = await page.locator(".thread-doc .doc-image img").count();
    check("the doc mounts no second copy of a shot that shows in the feed", inDoc ? `it holds ${inDoc}` : null);

    await button.click();
    const viewer = page.locator("dialog.annot");
    await viewer.waitFor({ timeout: 10000 });
    const inViewer = await viewer.locator(".annot-frame img").evaluate(async (el: HTMLImageElement) => {
      await el.decode().catch(() => undefined);
      return { natural: el.naturalWidth, src: el.src };
    });
    check("the viewer opens the full original", inViewer.natural !== WIDTH ? `it shows ${inViewer.natural} px wide` : inViewer.src !== original ? "it shows something else" : null);
    await page.keyboard.press("Escape");
    await viewer.waitFor({ state: "detached", timeout: 10000 });

    await button.click({ button: "right" });
    const save = page.getByRole("menuitem", { name: "Save image" });
    await save.waitFor({ timeout: 10000 });
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), save.click()]);
    const saved = Buffer.from(await Bun.file(await download.path()).bytes()).toString("base64");
    const sentBytes = original.slice(original.indexOf(",") + 1);
    check(
      "Save image saves the original bytes",
      saved === sentBytes ? null : `it saved ${Math.round((saved.length * 0.75) / 1024)} KB, not the ${Math.round((sentBytes.length * 0.75) / 1024)} KB sent`,
    );

    await page.evaluate(() => {
      const seen = window as unknown as { dragged?: string[]; dropped?: string[] };
      seen.dragged = [];
      seen.dropped = [];
      window.addEventListener("dragstart", (e) => seen.dragged?.push(e.target instanceof HTMLImageElement ? e.target.src : ""), { capture: true });
      window.addEventListener(
        "drop",
        (e) => {
          seen.dropped?.push(`${e.dataTransfer?.getData("text/uri-list") ?? ""}\n${e.dataTransfer?.getData("text/html") ?? ""}`);
          e.preventDefault();
          e.stopImmediatePropagation();
        },
        { capture: true },
      );
      window.addEventListener("dragover", (e) => e.preventDefault(), { capture: true });
    });
    await button.dragTo(composer(page));
    const drag = await page.evaluate(() => {
      const seen = window as unknown as { dragged?: string[]; dropped?: string[] };
      return { dragged: seen.dragged ?? [], dropped: (seen.dropped ?? []).filter((d) => d.trim()) };
    });
    check(
      "a drag starts on the original and carries it",
      drag.dragged[0] !== original
        ? `it started on ${drag.dragged[0]?.slice(0, 40) || "no image"}…`
        : drag.dropped.length && !drag.dropped.some((d) => d.includes(original))
          ? `it carried ${drag.dropped.map((d) => d.slice(0, 40)).join(", ")}…`
          : null,
    );

    let copies = 1;
    if (ENGINE === "webkit" && process.platform === "linux") console.log("- an agent's posted shot is left out here: Linux WebKit's Web Crypto (libgcrypt) takes the page down on one, on main too");
    else {
      const posted = await screenshotPng(page, "posted");
      const shot = join(data, "retina.png");
      writeFileSync(shot, Buffer.from(posted, "base64"));
      await kiwi(["-c", "thumbs", "--as", "bot", "send", "--to", "#general", "a retina shot", "--image", shot]);
      await feed.nth(1).waitFor({ timeout: 30000 });
      await page.waitForTimeout(500);
      check("an agent's posted Retina shot shows in the feed from a copy too", feedCopy(await shownIn(feed.nth(1)), `data:image/png;base64,${posted}`));
      copies = 2;
    }
    const made = await page.evaluate(() => (window as unknown as { thumbWorker: { made: number; failed: number } }).thumbWorker);
    check(
      "the copies are made in a worker, off the page's thread",
      made.failed ? `the worker failed ${made.failed} times` : made.made < copies ? `the worker made ${made.made} of ${copies} copies` : null,
    );
    check("no page errors", errors.length ? errors.join("; ") : null);
  }
} finally {
  closing = true;
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`chat images aren't shown from right-sized copies, in ${ENGINE}: ${failures.join("; ")}`);
  process.exitCode = 1;
}
