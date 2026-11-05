#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser } from "playwright-core";
import { DEMO_AGENT_HANDLES } from "../ui/src/demo/handle-names.ts";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const only = process.argv.find((a) => a.startsWith("--shot="))?.slice("--shot=".length);
const handles: string[] = [...DEMO_AGENT_HANDLES];

const SHOTS = [
  "channel",
  "dm",
  "theirs",
  "room",
  "thread-doc",
  "events",
  "event-runs",
  "ci-live",
  "left-out",
  "compact",
  "step-card",
  "handoff-card",
  "tasks",
  "task",
  "task-working",
  "task-review",
  "task-waiting",
  "task-done",
  "needs",
  "needs-asked-of",
  "needs-step",
  "needs-handoff",
  "specs",
  "spec-draft",
  "spec-inside",
  "spec-result",
  "specs-needs",
  "agent",
  "agent-working",
  "agent-offline",
  "needs-panel",
  "agents",
] as const;

const SETTLE_MS = 1200;

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const file = Bun.file(join(dist, path === "/" || !path.includes(".") ? "index.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

type Hit = { handle: string; text: string; place: string };
type Seen = { hits: Hit[]; renamed: number };

async function handlesShown(browser: Browser, shot: string): Promise<Seen> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}&handles=1`);
    await page.waitForSelector("#root *", { timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS);
    return await page.evaluate((handles) => {
      const skip = "code, pre, textarea, input, [contenteditable='true'], [data-handle]";
      const pattern = new RegExp(`(?<![\\w-])(${handles.join("|")})(?![\\w-])`, "g");
      const placeOf = (el: Element): string => {
        const parts: string[] = [];
        for (let e: Element | null = el; e && parts.length < 4; e = e.parentElement) {
          const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/)[0] : "";
          parts.unshift(cls ? `${e.tagName.toLowerCase()}.${cls}` : e.tagName.toLowerCase());
        }
        return parts.join(" > ");
      };
      const hits: { handle: string; text: string; place: string }[] = [];
      const look = (text: string, el: Element, kind: string) => {
        for (const found of text.matchAll(pattern)) hits.push({ handle: found[0], text: `${kind}${text.trim().slice(0, 140)}`, place: placeOf(el) });
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const el = node.parentElement;
        if (!el || el.closest(skip) || !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
        look(node.textContent ?? "", el, "");
      }
      for (const el of document.body.querySelectorAll("[title], [aria-label], [placeholder], img[alt]")) {
        if (el.closest(skip) && !(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) continue;
        for (const name of ["title", "aria-label", "placeholder", "alt"]) {
          const value = el.getAttribute(name);
          if (value) look(value, el, `[${name}] `);
        }
      }
      const mentioned = [...document.querySelectorAll("a[href^='kiwi-mention:']")].map((a) => decodeURIComponent((a.getAttribute("href") ?? "").slice("kiwi-mention:".length)));
      return { hits, renamed: mentioned.filter((name) => handles.includes(name)).length };
    }, handles);
  } finally {
    await page.close();
  }
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
let renamed = 0;
try {
  for (const shot of only ? [only] : SHOTS) {
    const { hits, renamed: links } = await handlesShown(browser, shot);
    renamed += links;
    if (hits.length) failed++;
    console.log(`${hits.length ? "✗" : "✓"} ${shot}${hits.length ? `: ${hits.length} handle${hits.length === 1 ? "" : "s"} shown to people` : " shows nicknames only"}`);
    for (const hit of hits) console.log(`    ${hit.handle} in ${hit.place}: ${JSON.stringify(hit.text)}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (!renamed) {
  console.error("no mention on any screen links to a renamed handle: the ?handles=1 demo renamed nothing, so this check proves nothing");
  process.exitCode = 1;
}
if (failed) {
  console.error(`${failed} views show an agent's handle where people should see its nickname, in ${engine}`);
  process.exitCode = 1;
}
