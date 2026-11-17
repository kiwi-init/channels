import { chromium } from "playwright-core";
import { readSeededFrame, watchSeededFrame } from "./seeded-frame.ts";

const SEQ = 7;
const TEXT = "Seeded: a reload opens the channel here";
const SHOW_AT = 400;

interface Case {
  name: string;
  body: string;
  script: string;
  expect: { atLeast: number } | { below: number } | "fails";
  resetsAtLeast?: number;
}

const row = (attrs = "", style = "") => `<div data-seq="${SEQ}" ${attrs} style="height:40px;${style}">${TEXT}</div>`;
const later = (code: string) => `setTimeout(() => { ${code} }, ${SHOW_AT});`;

const CASES: Case[] = [
  { name: "visible at once (positive control)", body: row(), script: "", expect: { below: SHOW_AT } },
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
  { name: "the right text on another row", body: `<div data-seq="${SEQ + 1}" style="height:40px">${TEXT}</div>`, script: "", expect: "fails" },
  { name: "never shown", body: row("", "visibility:hidden"), script: "", expect: "fails" },
];

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const c = CASES[Number(new URL(req.url).searchParams.get("case"))];
    if (!c) return new Response("no such case", { status: 404 });
    return new Response(`<!doctype html><html><body style="margin:0">${c.body}<script>${c.script}</script></body></html>`, { headers: { "content-type": "text/html" } });
  },
});

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const failures: string[] = [];
try {
  for (const [i, c] of CASES.entries()) {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await watchSeededFrame(context, { seq: SEQ, text: TEXT, budgetMs: 1_500 });
    const page = await context.newPage();
    await page.goto(`${server.url.origin}/?case=${i}`);
    const got = await readSeededFrame(page, 5_000).then(
      (f) => ({ ok: true as const, ms: Math.round(f.firstFrameMs), confirmedAfter: Math.round(f.confirmedMs - f.firstFrameMs), resets: f.resets }),
      (e: unknown) => ({ ok: false as const, why: e instanceof Error ? e.message : String(e) }),
    );
    await context.close();
    const want = c.expect;
    const pass = want === "fails" ? !got.ok : got.ok && ("atLeast" in want ? got.ms >= want.atLeast : got.ms < want.below) && got.resets >= (c.resetsAtLeast ?? 0);
    const saw = got.ok ? `ended at ${got.ms} ms, confirmed ${got.confirmedAfter} ms later, ${got.resets} early frame(s) dropped on recheck` : `failed: ${got.why}`;
    const expected = `${want === "fails" ? "fails" : "atLeast" in want ? `ends at or after ${want.atLeast} ms` : `ends before ${want.below} ms`}${c.resetsAtLeast ? `, with at least ${c.resetsAtLeast} early frame dropped` : ""}`;
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
