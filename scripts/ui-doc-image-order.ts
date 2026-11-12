#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { AgentSession, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel, SEND } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAEUlEQVR4nGMwXlWOFTEMpAQAoiQ/wY/S5UcAAAAASUVORK5CYII=";

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-image-order-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
writeFileSync(join(cli, "bin", "open"), "#!/bin/sh\nexit 0\n");
writeFileSync(join(cli, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n");
chmodSync(join(cli, "bin", "open"), 0o755);
chmodSync(join(cli, "bin", "xdg-open"), 0o755);
process.env.KIWI_HOME = join(cli, "home");
const picture = join(data, "agent.png");
writeFileSync(picture, Buffer.from(PNG, "base64"));
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim()}`)))));
};

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
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

const failures: string[] = [];
const check = (what: string, why: string | null): void => {
  if (why) failures.push(`${what}: ${why}`);
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "order");
  await composer(page).click();
  await paste(page, "shot.png");
  await page.locator(".composer .compose-file").first().waitFor({ timeout: 10000 });
  await page.keyboard.type("a line with an image");
  await page.keyboard.press(SEND);
  await page.waitForTimeout(2500);
  await page.keyboard.type("a later line");
  await page.keyboard.press(SEND);
  await page.waitForTimeout(2500);
  const image = await seen(page, "a line with an image");
  const later = await seen(page, "a later line");
  check(
    "a sent line with an image stays above a line sent after it",
    !image
      ? "the image line isn't on screen"
      : !later
        ? "the later line isn't on screen"
        : image.images !== 1
          ? `the image line shows ${image.images} images`
          : image.top >= later.top
            ? `the image line (y=${Math.round(image.top)}) is drawn below the later line (y=${Math.round(later.top)})`
            : null,
  );
  const shot = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);
  if (shot) await page.screenshot({ path: shot });

  let botIn = false;
  const joining = kiwi(["join", code, "order", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(page, () => !botIn);
  await joining;
  await kiwi(["-c", "order", "--as", "bot", "send", "--to", "#general", "an agent's picture", "--image", picture]);
  await page.waitForTimeout(3500);
  const agent = await seen(page, "an agent's picture");
  check("an agent's --image send into a doc shows its image once", !agent ? "the agent's line isn't on screen" : agent.images !== 1 ? `its row shows ${agent.images} images` : null);

  await composer(page).click();
  await paste(page, "plan.png");
  await page
    .locator(".main .composer input[type=file]")
    .setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n") });
  await page.locator(".main .composer .compose-file", { hasText: "notes.pdf" }).waitFor({ timeout: 10000 });
  await page.keyboard.type("a line with a picture and a file");
  await page.keyboard.press(SEND);
  await page.waitForTimeout(3500);
  const both = await seen(page, "a line with a picture and a file");
  const chips = await page.locator(".main [data-seq]", { hasText: "a line with a picture and a file" }).getByText("notes.pdf", { exact: true }).count();
  check(
    "a sent line with a picture and a file shows each once",
    !both ? "the line isn't on screen" : both.images !== 1 ? `its row shows ${both.images} images` : chips !== 1 ? `its row names notes.pdf ${chips} times` : null,
  );
  const bot = await AgentSession.open("order", loadConfig().channels["order"]!, "bot");
  const { messages } = await runAgent(bot.state());
  const sent = messages.find((m) => m.body?.includes("a line with a picture and a file"));
  const pointers = (sent?.imgs ?? []).filter((i) => i.ref && i.data === undefined).map((i) => i.name);
  const files = (sent?.files ?? []).map((f) => f.name);
  check(
    "another member reads that line's picture and file from the message itself, as pointers, with no doc",
    !sent
      ? "the agent never got the line"
      : !sent.block
        ? "the message names no block"
        : pointers.join() !== "plan.png"
          ? `the message carries the pictures [${pointers.join(", ")}] of ${sent.imgs?.length ?? 0}`
          : files.join() !== "notes.pdf"
            ? `the message carries the files [${files.join(", ")}]`
            : null,
  );
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`doc lines with images are drawn wrong, in ${ENGINE}: ${failures.join("; ")}`);
  process.exitCode = 1;
}
