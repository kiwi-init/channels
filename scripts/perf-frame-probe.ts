import { chromium } from "playwright-core";
import { readSeededFrame, watchSeededFrame } from "./seeded-frame.ts";

const SEQ = 7;
const TEXT = "Seeded: a reload opens the channel here";
const SHOW_AT = 400;
const BUSY = 300;

interface Case {
  name: string;
  body: string;
  script?: string;
  ahead?: string;
  expect: { atLeast: number } | { below: number } | "fails";
  resetsAtLeast?: number;
  windowAtLeast?: number;
}

const row = (attrs = "", style = "") => `<div data-seq="${SEQ}" ${attrs} style="height:40px;${style}">${TEXT}</div>`;
const later = (code: string) => `setTimeout(() => { ${code} }, ${SHOW_AT});`;
const busy = `{ const t = performance.now(); while (performance.now() - t < ${BUSY}) {} }`;
const reveal = `document.getElementById("r").style.visibility = "visible"; window.__revealedAt = performance.now();`;

const CASES: Case[] = [
  { name: "visible at once (positive control)", body: row(), expect: { below: SHOW_AT } },
  { name: "inserted after a delay", body: `<div id="feed"></div>`, script: later(`document.getElementById("feed").innerHTML = ${JSON.stringify(row())};`), expect: { atLeast: SHOW_AT } },
  {
    name: "held by the cold-open hold",
    body: `<div class="feed-list" data-unfinished style="visibility:hidden">${row()}</div>`,
    script: later(`const f = document.querySelector(".feed-list"); f.removeAttribute("data-unfinished"); f.style.visibility = "";`),
    expect: { atLeast: SHOW_AT },
  },
  { name: "display none", body: row('id="r"', "display:none"), script: later(`document.getElementById("r").style.display = "";`), expect: { atLeast: SHOW_AT } },
  { name: "opacity 0", body: row('id="r"', "opacity:0"), script: later(`document.getElementById("r").style.opacity = "1";`), expect: { atLeast: SHOW_AT } },
  { name: "zero height", body: row('id="r"', "height:0;overflow:hidden"), script: later(`document.getElementById("r").style.height = "40px";`), expect: { atLeast: SHOW_AT } },
  { name: "below the viewport", body: `<div style="height:3000px"></div>${row()}`, script: later(`window.scrollTo(0, document.body.scrollHeight);`), expect: { atLeast: SHOW_AT } },
  {
    name: "one frame early, then hidden",
    body: row('id="r"', "visibility:hidden"),
    script: `setTimeout(() => requestAnimationFrame(() => { const r = document.getElementById("r"); r.style.visibility = "visible"; requestAnimationFrame(() => (r.style.visibility = "hidden")); }), 100); ${later(`document.getElementById("r").style.visibility = "visible";`)}`,
    expect: { atLeast: SHOW_AT },
    resetsAtLeast: 1,
  },
  { name: "a long task, then the reveal", body: row('id="r"', "visibility:hidden"), script: later(`${busy} ${reveal}`), expect: { atLeast: SHOW_AT + BUSY } },
  {
    name: "a frame callback ahead of the probe works, then reveals, in the probe's frame",
    body: row('id="r"', "visibility:hidden"),
    ahead: `(() => { const start = performance.now(); const loop = () => { if (performance.now() - start >= ${SHOW_AT} && document.getElementById("r")) { ${busy} ${reveal} } else requestAnimationFrame(loop); }; requestAnimationFrame(loop); })();`,
    expect: { atLeast: SHOW_AT + BUSY },
  },
  {
    name: "work after the probe sees the row delays its paint",
    body: row('id="r"', "visibility:hidden"),
    script: later(`${reveal} requestAnimationFrame(() => ${busy});`),
    expect: { atLeast: SHOW_AT + BUSY },
    windowAtLeast: BUSY - 50,
  },
  { name: "the right text on another row", body: `<div data-seq="${SEQ + 1}" style="height:40px">${TEXT}</div>`, expect: "fails" },
  { name: "never shown", body: row("", "visibility:hidden"), expect: "fails" },
];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const c = CASES[Number(new URL(req.url).searchParams.get("case"))];
    if (!c) return new Response("no such case", { status: 404 });
    return new Response(`<!doctype html><html><body style="margin:0">${c.body}<script>${c.script ?? ""}</script></body></html>`, { headers: { "content-type": "text/html" } });
  },
});

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const failures: string[] = [];
try {
  for (const [i, c] of CASES.entries()) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    if (c.ahead) await context.addInitScript({ content: c.ahead });
    await watchSeededFrame(context, { seq: SEQ, text: TEXT, budgetMs: 2_000 });
    const page = await context.newPage();
    await page.goto(`${server.url.origin}/?case=${i}`);
    const got = await readSeededFrame(page, 5_000).then(
      (f) => ({ ok: true as const, seen: Math.round(f.seenMs), end: Math.round(f.paintedByMs), window: Math.round(f.paintedByMs - f.seenMs), resets: f.resets }),
      (e: unknown) => ({ ok: false as const, why: e instanceof Error ? e.message : String(e) }),
    );
    const revealed: unknown = await page.evaluate(() => Reflect.get(window, "__revealedAt"));
    await context.close();
    const revealedAt = typeof revealed === "number" ? Math.round(revealed) : null;
    const want = c.expect;
    const pass =
      want === "fails"
        ? !got.ok
        : got.ok &&
          ("atLeast" in want ? got.end >= want.atLeast : got.end < want.below) &&
          got.resets >= (c.resetsAtLeast ?? 0) &&
          got.window >= (c.windowAtLeast ?? 0) &&
          (revealedAt === null || (got.seen >= revealedAt && got.end >= revealedAt));
    const saw = got.ok
      ? `seen at ${got.seen} ms, ends at ${got.end} ms (paint window ${got.window} ms), ${got.resets} early frame(s) dropped${revealedAt === null ? "" : `; the page revealed it at ${revealedAt} ms`}`
      : `failed: ${got.why}`;
    const expected = [
      want === "fails" ? "fails" : "atLeast" in want ? `ends at or after ${want.atLeast} ms` : `ends before ${want.below} ms`,
      c.resetsAtLeast ? `at least ${c.resetsAtLeast} early frame dropped` : "",
      c.windowAtLeast ? `a paint window of at least ${c.windowAtLeast} ms` : "",
      revealedAt === null ? "" : "seen and ended no earlier than the reveal",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`${pass ? "ok  " : "FAIL"} ${c.name}: ${saw} (expected: ${expected})`);
    if (!pass) failures.push(c.name);
  }
} finally {
  await browser.close();
  server.stop(true);
}
if (failures.length) {
  console.error(`the reload probe ended early or wrongly in ${failures.length} case(s): ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`the reload probe held in all ${CASES.length} cases`);
