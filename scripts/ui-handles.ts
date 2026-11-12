#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { DEMO_AGENT_HANDLES } from "../ui/src/demo/handle-names.ts";
import { pageErrors } from "./page-errors.ts";

const at = process.argv.indexOf("--dist");
const dist = at > 0 ? (process.argv[at + 1] ?? "ui/dist") : "ui/dist";
if (!existsSync(join(dist, "index.html"))) throw new Error(`no index.html in ${dist}: run bun run ui:build first`);
const engine = process.argv.includes("--webkit") ? "webkit" : "chromium";
const only = process.argv.find((a) => a.startsWith("--shot="))?.slice("--shot=".length);
const handles: string[] = [...DEMO_AGENT_HANDLES];

type Screen = { ready: string; mentions?: true };

const FEED = ".feed .msg";
const SHOTS: Record<string, Screen> = {
  channel: { ready: FEED, mentions: true },
  dm: { ready: FEED },
  theirs: { ready: FEED },
  room: { ready: FEED },
  "thread-doc": { ready: FEED },
  events: { ready: FEED, mentions: true },
  "event-runs": { ready: FEED, mentions: true },
  "ci-live": { ready: FEED, mentions: true },
  "left-out": { ready: FEED, mentions: true },
  compact: { ready: FEED, mentions: true },
  "step-card": { ready: ".feed .ask", mentions: true },
  "handoff-card": { ready: ".feed .ask", mentions: true },
  tasks: { ready: ".board" },
  task: { ready: ".panel-body .tp-brief" },
  "task-working": { ready: ".panel-body", mentions: true },
  "task-review": { ready: ".panel-body" },
  "task-waiting": { ready: ".panel-body" },
  "task-done": { ready: ".panel-body" },
  needs: { ready: ".needs-card" },
  "needs-asked-of": { ready: ".needs-card" },
  "needs-step": { ready: ".needs-card .ask" },
  "needs-handoff": { ready: ".needs-card .ask" },
  specs: { ready: ".board" },
  "spec-draft": { ready: ".spec-rail" },
  "spec-inside": { ready: ".spec-top" },
  "spec-result": { ready: ".spec-box" },
  "specs-needs": { ready: ".needs-card" },
  agent: { ready: ".person-name-text", mentions: true },
  "agent-working": { ready: ".person-name-text", mentions: true },
  "agent-offline": { ready: ".person-name-text", mentions: true },
  "needs-panel": { ready: ".person-name-text" },
  agents: { ready: ".lane" },
};

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

type Seen = { problems: string[]; hits: string[] };
type Sabotage = (page: Page) => Promise<void>;

async function scan(page: Page): Promise<{ hits: string[]; renamed: number; agents: number; crashed: boolean }> {
  return await page.evaluate((names) => {
    const skip = "code, pre, textarea, input, [contenteditable='true'], [data-handle]";
    const pattern = new RegExp(`(?<![\\w-])(${names.join("|")})(?![\\w-])`, "g");
    const placeOf = (el: Element): string => {
      const parts: string[] = [];
      for (let e: Element | null = el; e && parts.length < 4; e = e.parentElement) {
        const cls = typeof e.className === "string" ? e.className.trim().split(/\s+/)[0] : "";
        parts.unshift(cls ? `${e.tagName.toLowerCase()}.${cls}` : e.tagName.toLowerCase());
      }
      return parts.join(" > ");
    };
    const hits: string[] = [];
    const look = (text: string, el: Element, kind: string) => {
      for (const found of text.matchAll(pattern)) hits.push(`${found[0]} in ${placeOf(el)}: ${JSON.stringify(`${kind}${text.trim().slice(0, 140)}`)}`);
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
    return {
      hits,
      renamed: mentioned.filter((name) => names.includes(name)).length,
      agents: Number(document.documentElement.dataset.demoHandles ?? "0"),
      crashed: !!document.querySelector(".crash, [role='alert'].crash"),
    };
  }, handles);
}

async function check(browser: Browser, shot: string, screen: Screen, sabotage?: Sabotage): Promise<Seen> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  await pageErrors(page, (e) => errors.push(e));
  try {
    await page.goto(`http://127.0.0.1:${server.port}/?shot=${shot}&handles=1`);
    const ready = await page
      .waitForSelector(screen.ready, { state: "visible", timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(SETTLE_MS);
    if (sabotage) await sabotage(page);
    const seen = await scan(page);
    const problems = [
      ...errors.map((e) => `page error: ${e}`),
      ...(seen.crashed ? ["the screen shows a crash boundary"] : []),
      ...(!ready || !(await page.$(screen.ready)) ? [`${screen.ready} never showed`] : []),
      ...(seen.agents ? [] : ["the ?handles=1 demo renamed no agent here"]),
      ...(screen.mentions && !seen.renamed ? ["no mention links to a renamed handle"] : []),
    ];
    return { problems, hits: seen.hits };
  } finally {
    await page.close();
  }
}

const crash: Sabotage = (page) => page.evaluate(() => void ((document.querySelector("#root") ?? document.body).innerHTML = '<div class="crash" role="alert">This view hit a problem</div>'));
const thrown: Sabotage = (page) =>
  page
    .evaluate(
      () =>
        void setTimeout(() => {
          throw new Error("self-test: a screen that throws");
        }),
    )
    .then(() => page.waitForTimeout(100));

async function selfTest(browser: Browser): Promise<string[]> {
  const healthy = await check(browser, "channel", { ready: FEED, mentions: true });
  const cases: [string, Seen][] = [
    ["a crash boundary in place of a screen", await check(browser, "needs", { ready: ".needs-card" }, crash)],
    ["a screen that throws", await check(browser, "needs", { ready: ".needs-card" }, thrown)],
    ["a screen whose surface never mounts", await check(browser, "tasks", { ready: ".needs-card" })],
  ];
  return [
    ...(healthy.problems.length || healthy.hits.length ? [`a healthy screen failed: ${[...healthy.problems, ...healthy.hits].join("; ")}`] : []),
    ...cases.flatMap(([name, seen]) => (seen.problems.length ? [] : [`${name} passed`])),
  ];
}

const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
let failed = 0;
try {
  const broken = await selfTest(browser);
  if (broken.length) {
    for (const why of broken) console.error(`self-test: ${why}`);
    console.error("the check can't tell a broken screen from a clean one, so its results mean nothing");
    process.exitCode = 1;
  } else console.log("✓ self-test: a healthy screen passes; a crash, a thrown error and an unmounted surface each fail");
  const shots = only ? Object.entries(SHOTS).filter(([name]) => name === only) : Object.entries(SHOTS);
  if (!shots.length) throw new Error(`no shot called ${only}`);
  for (const [shot, screen] of shots) {
    const { problems, hits } = await check(browser, shot, screen);
    const bad = problems.length + hits.length;
    if (bad) failed++;
    console.log(`${bad ? "✗" : "✓"} ${shot}${hits.length ? `: ${hits.length} handle${hits.length === 1 ? "" : "s"} shown to people` : problems.length ? ": not checked" : " shows nicknames only"}`);
    for (const why of [...problems, ...hits]) console.log(`    ${why}`);
  }
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`${failed} views show an agent's handle or could not be checked, in ${engine}`);
  process.exitCode = 1;
}
