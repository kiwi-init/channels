#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

interface Caret {
  block: number;
  offset: number;
  length: number;
  focusBlock: number;
}

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const WORD = process.platform === "darwin" ? "Alt" : "Control";

async function put(page: Page, block: number, at: "start" | "end"): Promise<void> {
  await page.evaluate(
    ({ block, at }) => {
      const body = document.querySelectorAll(".thread-doc .blk:not(.is-hidden) .blk-body")[block];
      if (!body) throw new Error(`no block ${block}`);
      const walk = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n instanceof Text && n.data.length) texts.push(n);
      const t = at === "start" ? texts[0] : texts.at(-1);
      if (!t) throw new Error(`block ${block} has no text`);
      document.getSelection()?.collapse(t, at === "start" ? 0 : t.data.length);
    },
    { block, at },
  );
  await page.waitForTimeout(50);
}

async function caret(page: Page): Promise<Caret> {
  return page.evaluate(() => {
    const sel = document.getSelection();
    const bodies = [...document.querySelectorAll(".thread-doc .blk:not(.is-hidden) .blk-body")];
    const blockOf = (n: Node | null | undefined) => bodies.findIndex((b) => !!n && b.contains(n));
    const a = sel?.anchorNode;
    const f = sel?.focusNode;
    const body = bodies[blockOf(f)];
    let offset = -1;
    if (body && f && sel) {
      const r = document.createRange();
      r.setStart(body, 0);
      r.setEnd(f, sel.focusOffset);
      offset = r.toString().length;
    }
    return { block: blockOf(a), offset, length: body?.textContent?.length ?? -1, focusBlock: blockOf(f) };
  });
}

const checks: { name: string; run: (page: Page) => Promise<string | null> }[] = [
  {
    name: "← at a block's start lands at the end of the one before",
    run: async (page) => {
      await put(page, 2, "start");
      await page.keyboard.press("ArrowLeft");
      const c = await caret(page);
      return c.focusBlock === 1 && c.offset === c.length ? null : JSON.stringify(c);
    },
  },
  {
    name: "→ at a block's end lands at the start of the next",
    run: async (page) => {
      await put(page, 1, "end");
      await page.keyboard.press("ArrowRight");
      const c = await caret(page);
      return c.focusBlock === 2 && c.offset === 0 ? null : JSON.stringify(c);
    },
  },
  {
    name: "↑ on a block's first line goes to the block above",
    run: async (page) => {
      await put(page, 2, "start");
      await page.keyboard.press("ArrowUp");
      const c = await caret(page);
      return c.focusBlock === 1 ? null : JSON.stringify(c);
    },
  },
  {
    name: "↓ on a block's last line goes to the block below",
    run: async (page) => {
      await put(page, 1, "end");
      await page.keyboard.press("ArrowDown");
      const c = await caret(page);
      return c.focusBlock === 2 ? null : JSON.stringify(c);
    },
  },
  {
    name: "⌥← at a block's start jumps to the last word of the one before",
    run: async (page) => {
      await put(page, 2, "start");
      await page.keyboard.press(`${WORD}+ArrowLeft`);
      const c = await caret(page);
      return c.focusBlock === 1 && c.offset > 0 && c.offset < c.length ? null : JSON.stringify(c);
    },
  },
  {
    name: "⇧↓ extends the selection into the next block",
    run: async (page) => {
      await put(page, 1, "end");
      await page.keyboard.press("Shift+ArrowDown");
      const c = await caret(page);
      return c.block === 1 && c.focusBlock === 2 ? null : JSON.stringify(c);
    },
  },
  {
    name: "⇧→ at a block's end extends the selection into the next",
    run: async (page) => {
      await put(page, 1, "end");
      await page.keyboard.press("Shift+ArrowRight");
      const c = await caret(page);
      return c.block === 1 && c.focusBlock === 2 ? null : JSON.stringify(c);
    },
  },
  {
    name: "⌘A selects the whole thread",
    run: async (page) => {
      await put(page, 2, "start");
      await page.keyboard.press(`${MOD}+a`);
      const c = await page.evaluate(() => {
        const bodies = [...document.querySelectorAll(".thread-doc .blk:not(.is-hidden) .blk-body")];
        const sel = document.getSelection();
        return { first: !!sel && sel.containsNode(bodies[0]!, true), last: !!sel && sel.containsNode(bodies.at(-1)!, true) };
      });
      return c.first && c.last ? null : JSON.stringify(c);
    },
  },
  {
    name: "Enter breaks the line and stays in your block; ⌘/Ctrl+Enter sends it and starts the next",
    run: async (page) => {
      const blocks = () => page.locator(".thread-doc .blk:not(.is-hidden)").count();
      await page.locator(".thread-doc .doc-tail").click();
      await page.keyboard.type("enter check");
      const typed = await blocks();
      await page.keyboard.press("Enter");
      await page.keyboard.type("second line");
      const afterEnter = await blocks();
      const lines = await page.evaluate(() => document.getSelection()?.anchorNode?.parentElement?.closest(".blk")?.querySelectorAll("p").length ?? 0);
      await page.keyboard.press(`${MOD}+Enter`);
      await page.waitForTimeout(300);
      const caretLine = await page.evaluate(() => {
        const sel = document.getSelection()?.anchorNode;
        const el = sel instanceof Element ? sel : sel?.parentElement;
        return el?.closest(".blk")?.querySelector(".blk-body")?.textContent ?? null;
      });
      return afterEnter === typed && lines >= 2 && caretLine === "" ? null : JSON.stringify({ typed, afterEnter, lines, caretLine });
    },
  },
  {
    name: "with a suggestion open, ⌘/Ctrl+Enter still sends the line",
    run: async (page) => {
      await page.locator(".thread-doc .doc-tail").click();
      await page.keyboard.type("ping @");
      const menu = await page
        .locator(".doc-suggest")
        .waitFor({ timeout: 3000 })
        .then(
          () => true,
          () => false,
        );
      await page.keyboard.press(`${MOD}+Enter`);
      await page.waitForTimeout(300);
      const caretLine = await page.evaluate(() => {
        const sel = document.getSelection()?.anchorNode;
        const el = sel instanceof Element ? sel : sel?.parentElement;
        return el?.closest(".blk")?.querySelector(".blk-body")?.textContent ?? null;
      });
      return menu && caretLine === "" ? null : JSON.stringify({ menu, caretLine });
    },
  },
];

const engine = process.argv.includes("--chromium") ? "chromium" : "webkit";
const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`http://127.0.0.1:${server.port}/?shot=${process.env.DOC_KEYS_SHOT ?? "thread-doc"}`);
  await page.waitForFunction(() => document.querySelectorAll(".thread-doc .blk:not(.is-hidden)").length >= 3, null, { timeout: 30_000 });
  await page.locator(".thread-doc .ProseMirror").focus();
  for (const check of checks) {
    const why = await check.run(page);
    if (why) failed++;
    console.log(`${why ? "✗" : "✓"} ${check.name}${why ? `: ${why}` : ""}`);
  }
} finally {
  await browser.close();
  server.stop(true);
}
if (failed) {
  console.error(`${failed} of ${checks.length} keyboard checks failed in ${engine}`);
  process.exitCode = 1;
}
