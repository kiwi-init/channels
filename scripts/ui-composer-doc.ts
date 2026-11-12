#!/usr/bin/env bun
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, newChannel, say, SEND } from "./perf-ui.ts";
import { pageErrors } from "./page-errors.ts";

if (process.argv.includes("--help")) {
  console.log(`The composer in a thread doc keeps what writing in the doc had (T5115). In a fresh channel's #general:
refused sends that come back late and out of order never overwrite the draft being typed and wait in the stash, and one
refused into an empty composer comes back with its image; a PDF goes out as a file of its line; Edit and ↑ open your
line in the composer, Esc or leaving puts the draft back and saving changes the line in place; a pasted image goes out with its
line while uploads are slow, also when you switch channels before they end; the / menu stays on screen at every width;
and ⌘/Ctrl+Enter sends with a suggestion open. The relay refuses on cue: the check answers the app's message posts.

  bun scripts/ui-composer-doc.ts [--webkit] [--dist=ui/dist-harness]

Needs bun scripts/ui-harness.ts first.`);
  process.exit(0);
}

const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const UPLOAD_MS = 3000;
const READ_MS = 600;

const data = mkdtempSync(join(tmpdir(), "kiwi-composer-doc-"));
mkdirSync(join(data, "relay"));
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser: Browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });

const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

const refusing = { on: false, held: [] as (() => void)[] };
const uploads = { slowMs: 0, holding: false, held: [] as (() => void)[] };

const sendFrame = (m: string | Buffer): string | null => {
  if (typeof m !== "string") return null;
  try {
    const f: unknown = JSON.parse(m);
    return f && typeof f === "object" && "t" in f && f.t === "send" && "id" in f && typeof f.id === "string" ? f.id : null;
  } catch {
    // Not JSON: the frame isn't a send, so it passes through untouched.
    return null;
  }
};

async function until(what: string, ok: () => boolean, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

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

interface Line {
  rows: number;
  images: number;
  text: string;
}

const lineOf = (page: Page, want: string): Promise<Line> =>
  page.evaluate((w) => {
    const rows = [...document.querySelectorAll<HTMLElement>(".main article.msg, .main .thread-doc section.blk:not(.is-hidden)")].filter(
      (r) => r.getClientRects().length > 0 && r.innerText.includes(w),
    );
    const last = rows.at(-1);
    return { rows: rows.length, images: last?.querySelectorAll("img").length ?? 0, text: last?.innerText ?? "" };
  }, want);

async function switchTo(page: Page, name: string): Promise<void> {
  await page.evaluate((title) => {
    const tile = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Channels"] button.tile')].find((b) => (b.getAttribute("aria-label") ?? "").split(",")[0] === title);
    if (!tile) throw new Error(`no ${title} tile in the rail`);
    tile.click();
  }, name);
  await page.waitForFunction((title) => document.querySelector('nav[aria-label="Channels"] button.tile[aria-current="page"]')?.getAttribute("aria-label")?.split(",")[0] === title, name, {
    timeout: 15000,
  });
}

async function refusals(page: Page): Promise<void> {
  const area = composer(page);
  const files = page.locator(".main .composer .compose-file");
  await say(page, "the doc opens with this line");
  const first = page.locator(".main article.msg", { hasText: "the doc opens with this line" }).last();
  await first.waitFor({ timeout: 15000 });
  await first.hover();
  await first.getByRole("button", { name: "Edit" }).waitFor({ timeout: 15000 });
  await area.click();
  refusing.on = true;
  uploads.holding = true;
  await area.click();
  await paste(page, "late.png");
  await files.first().waitFor({ timeout: 10000 });
  await page.keyboard.type("refused A, with an image");
  await page.keyboard.press(SEND);
  await page.keyboard.type("refused B");
  await page.keyboard.press(SEND);
  await until("B's post", () => refusing.held.length >= 1);
  await page.keyboard.type("C, being typed");
  refusing.held.shift()?.();
  await page.waitForTimeout(600);
  uploads.holding = false;
  for (const go of uploads.held.splice(0)) go();
  await until("A's post, after its upload", () => refusing.held.length >= 1);
  refusing.held.shift()?.();
  await page.waitForTimeout(800);
  const value = await area.inputValue();
  check("refusals that come back late and out of order never overwrite the draft being typed", value === "C, being typed" ? null : `the composer holds ${JSON.stringify(value)}`);
  const chip = await page
    .locator(".main .composer .stash-chip")
    .innerText()
    .catch(() => "no stash chip");
  check("both refused lines wait in the stash", /2\s*stashed/.test(chip) ? null : `the stash chip says ${JSON.stringify(chip)}`);
  const hint = await page
    .locator(".main .compose-hint")
    .innerText()
    .catch(() => "");
  check("the stash cue says the refused line's image didn't fit", hint.includes("didn't fit") ? null : `the cue says ${JSON.stringify(hint)}`);
  const left = (await lineOf(page, "refused A")).rows + (await lineOf(page, "refused B")).rows;
  check("refused lines leave the doc", left ? `${left} refused line(s) still show` : null);
  await area.press("ControlOrMeta+Shift+S");
  await page.waitForTimeout(300);
  const brought = await area.inputValue();
  check("⇧⌘S brings back the newest refusal", brought === "refused A, with an image" ? null : `the composer holds ${JSON.stringify(brought)}`);
  await area.fill("");

  await area.click();
  await paste(page, "back.png");
  await files.first().waitFor({ timeout: 10000 });
  await page.keyboard.type("refused D, back in the composer");
  await page.keyboard.press(SEND);
  await until("D's post", () => refusing.held.length >= 1);
  refusing.held.shift()?.();
  await page.waitForTimeout(800);
  refusing.on = false;
  const back = await area.inputValue();
  const images = await files.count();
  check(
    "a refusal into an empty composer comes back with its image",
    back === "refused D, back in the composer" && images === 1 ? null : `the composer holds ${JSON.stringify(back)} and ${images} file(s)`,
  );
  while ((await files.count()) > 0) await files.first().locator(".compose-file-x").click();
  await area.fill("");
}

async function pdf(page: Page): Promise<void> {
  await page
    .locator(".main .composer input[type=file]")
    .setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n") });
  const chip = page.locator(".main .composer .compose-file", { hasText: "notes.pdf" });
  const taken = await chip.waitFor({ timeout: 10000 }).then(
    () => true,
    () => false,
  );
  check("the composer in a thread doc takes a PDF", taken ? null : "notes.pdf never showed in the composer");
  if (!taken) return;
  await say(page, "the notes, as a pdf");
  await page.waitForTimeout(3000);
  const line = await lineOf(page, "the notes, as a pdf");
  check("a PDF goes out as a file of its line", line.rows && line.text.includes("notes.pdf") ? null : `the line reads ${JSON.stringify(line.text)}`);
}

async function edits(page: Page): Promise<void> {
  const area = composer(page);
  const editor = page.locator(".main").getByRole("textbox", { name: "Edit message" });
  await say(page, "edit me once");
  const row = page.locator(".main article.msg", { hasText: "edit me once" }).last();
  await row.waitFor({ timeout: 15000 });
  await area.fill("a half-typed draft");
  await row.hover();
  await row.getByRole("button", { name: "Edit" }).click();
  await editor.waitFor({ timeout: 5000 }).catch(() => {});
  const opened = (await editor.count()) === 1 ? await editor.inputValue() : "no editor";
  const kept = await area.inputValue();
  check(
    "Edit opens your line in a box in its row, and the composer keeps its draft",
    opened === "edit me once" && kept === "a half-typed draft" ? null : `the row editor holds ${JSON.stringify(opened)}, the composer ${JSON.stringify(kept)}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("Esc closes the box and changes nothing", !(await editor.count()) && (await area.inputValue()) === "a half-typed draft" ? null : `${await editor.count()} editor(s) open`);
  await row.hover();
  await row.getByRole("button", { name: "Edit" }).click();
  await editor.waitFor({ timeout: 5000 }).catch(() => {});
  await switchTo(page, "away");
  const elsewhere = await page.locator(".main").getByRole("textbox", { name: "Edit message" }).count();
  await switchTo(page, "composer");
  await composer(page).waitFor({ timeout: 30000 });
  const home = await area.inputValue();
  check("leaving mid-edit keeps the draft", elsewhere === 0 && home === "a half-typed draft" ? null : `${elsewhere} editor(s) elsewhere, back home the composer holds ${JSON.stringify(home)}`);
  await page.keyboard.press("Escape");
  await area.fill("");
  await area.press("ArrowUp");
  await editor.waitFor({ timeout: 5000 }).catch(() => {});
  const up = (await editor.count()) === 1 ? await editor.inputValue() : "no editor";
  check("↑ in an empty composer opens your last line in its row", up === "edit me once" ? null : `the row editor holds ${JSON.stringify(up)}`);
  await editor.fill("edit me twice");
  await editor.press("Enter");
  await page.waitForTimeout(3000);
  const was = await lineOf(page, "edit me once");
  const now = await lineOf(page, "edit me twice");
  const after = await area.inputValue();
  check("saving changes the line in place", was.rows === 0 && now.rows === 1 && after === "" ? null : `${was.rows} old, ${now.rows} new line(s), the composer holds ${JSON.stringify(after)}`);
}

async function pasted(page: Page): Promise<void> {
  uploads.slowMs = UPLOAD_MS;
  await page.evaluate((ms) => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (this: FileReader, blob: Blob): void {
      setTimeout(() => read.call(this, blob), ms);
    };
  }, READ_MS);
  const area = composer(page);
  const files = page.locator(".main .composer .compose-file");
  const scenario = async (what: string, text: string, steps: () => Promise<void>): Promise<void> => {
    await area.click();
    await steps();
    await page.waitForTimeout(UPLOAD_MS + 3000);
    const line = await lineOf(page, text);
    const left = await files.count();
    check(what, line.rows !== 1 ? `${line.rows} line(s) show it` : line.images !== 1 ? `the line shows ${line.images} images` : left ? `${left} file(s) left in the composer` : null);
  };
  await scenario(`paste an image, type, send (uploads take ${UPLOAD_MS} ms)`, "Album viu essa imagem ?", async () => {
    await paste(page, "first.png");
    await files.first().waitFor({ timeout: 10000 });
    await page.keyboard.type("Album viu essa imagem ?");
    await page.keyboard.press(SEND);
  });
  await scenario(`type, paste an image, send at once (reading it takes ${READ_MS} ms, uploads ${UPLOAD_MS} ms)`, "e essa aqui ?", async () => {
    await page.keyboard.type("e essa aqui ?");
    await paste(page, "second.png");
    await page.keyboard.press(SEND);
  });
  await area.click();
  await page.keyboard.type("a terceira foi junto ?");
  await paste(page, "third.png");
  await files.first().waitFor({ timeout: 10000 });
  await page.keyboard.press(SEND);
  await switchTo(page, "away");
  await page.waitForTimeout(UPLOAD_MS + 2000);
  await switchTo(page, "composer");
  await composer(page).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1000);
  const away = await lineOf(page, "a terceira foi junto ?");
  const kept = await composer(page).inputValue();
  const keptFiles = await files.count();
  const sent = away.rows === 1 && away.images === 1 && !keptFiles;
  const back = away.rows === 0 && kept === "a terceira foi junto ?" && keptFiles === 1;
  check(
    "a line sent with an image just before you open another channel goes out, or waits in the composer with its image",
    sent || back ? null : `${away.rows} line(s) with ${away.images} image(s) show it, the composer holds ${JSON.stringify(kept)} and ${keptFiles} file(s)`,
  );
  while ((await files.count()) > 0) await files.first().locator(".compose-file-x").click();
  await composer(page).fill("");
  uploads.slowMs = 0;
}

async function slashMenu(page: Page): Promise<void> {
  const area = composer(page);
  for (const [label, width] of [
    ["wide", 1280],
    ["narrow", 760],
    ["tight", 620],
  ] as const) {
    await page.setViewportSize({ width, height: 700 });
    await area.fill("");
    await area.click();
    await page.keyboard.type("/");
    const menu = page.locator('.main ul.mentions[aria-label="Commands"]');
    const open = await menu.waitFor({ timeout: 5000 }).then(
      () => true,
      () => false,
    );
    const seen = open
      ? await menu.evaluate((ul) => {
          const r = ul.getBoundingClientRect();
          const spill = Math.max(0, ...[...ul.querySelectorAll("li")].map((li) => li.getBoundingClientRect().right - r.right));
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: innerWidth, h: innerHeight, rows: ul.querySelectorAll("li").length, spill };
        })
      : null;
    check(
      `the / menu opens over the composer and stays on screen, ${label}`,
      !seen ? "no menu" : seen.rows > 0 && seen.top >= 0 && seen.left >= 0 && seen.bottom <= seen.h && seen.right <= seen.w && seen.spill <= 1 ? null : JSON.stringify(seen),
    );
    await page.keyboard.press("Escape");
    await area.fill("");
  }
  await page.setViewportSize({ width: 1280, height: 860 });
}

async function sendOverMenu(): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  try {
    const page = await context.newPage();
    await page.goto(`${BASE}?shot=channel`);
    const area = composer(page);
    await area.waitFor({ timeout: 30000 });
    await area.click();
    await page.keyboard.type("ping @");
    const people = page.locator('.main ul.mentions[aria-label="People"]');
    const open = await people.waitFor({ timeout: 5000 }).then(
      () => true,
      () => false,
    );
    await page.keyboard.press("ControlOrMeta+Enter");
    await page.waitForTimeout(300);
    const left = await area.inputValue();
    check("⌘/Ctrl+Enter sends with a suggestion open", open && left === "" ? null : `menu ${open ? "open" : "never opened"}, the composer holds ${JSON.stringify(left)}`);
  } finally {
    await context.close();
  }
}

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((m) => {
      const id = refusing.on ? sendFrame(m) : null;
      if (id) ws.send(JSON.stringify({ t: "err", id, error: "the check answers this one by post", tag: "Held" }));
      else server.send(m);
    });
    server.onMessage((m) => ws.send(m));
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && /^\/v1\/rooms\/[^/]+\/messages$/.test(url.pathname) && refusing.on) {
      await new Promise<void>((release) => refusing.held.push(release));
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "this check refuses it", tag: "ReadOnly" }) });
    }
    if (req.method() !== "GET" && url.pathname.includes("/blobs/")) {
      if (uploads.holding) await new Promise<void>((go) => uploads.held.push(go));
      else if (uploads.slowMs) await Bun.sleep(uploads.slowMs);
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors: string[] = [];
  await pageErrors(page, (e) => errors.push(e));
  await page.goto(BASE);
  await firstRun(page, "jow");
  await newChannel(page, "away");
  await newChannel(page, "composer");
  await refusals(page);
  await edits(page);
  await pdf(page);
  await pasted(page);
  await slashMenu(page);
  check("no page errors", errors.length ? errors.slice(0, 3).join("; ") : null);
  await sendOverMenu();
} finally {
  for (const go of [...refusing.held.splice(0), ...uploads.held.splice(0)]) go();
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`the composer in a thread doc lost something, in ${ENGINE}: ${failures.join("; ")}`);
  process.exitCode = 1;
}
