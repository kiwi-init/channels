#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";

import { afkSceneHtml } from "../ui/afk-scene.build.ts";

if (process.argv.includes("--help")) {
  console.log(`The AFK scene file (T26) in the mods' frame, under the frame's own CSP. It checks that the default scene, built from
the meadow, says it's ready once it draws; that a scene can't reach the network or the page that frames it; that it hears the
state the app sends; and that a different file swapped in runs in its place.

  bun scripts/ui-afk-scene.ts [--chromium] [--shot=scene.png]`);
  process.exit(0);
}

const ROOT = resolve(import.meta.dir, "..");
const MOD_PROTOCOL = JSON.parse(/export const MOD_PROTOCOL = (\S+)/.exec(readFileSync(join(ROOT, "ui/src/mods/protocol.ts"), "utf8"))![1]!) as unknown;
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const SHOT = process.argv.find((a) => a.startsWith("--shot="))?.slice(7);

const dir = mkdtempSync(join(tmpdir(), "kiwi-afk-scene-"));
const entry = join(dir, "loader.ts");
writeFileSync(
  entry,
  `import { runScene } from ${JSON.stringify(join(ROOT, "ui/src/mods/frame/scene.ts"))}
addEventListener("message", (e) => {
  if (e.source === parent && e.data?.kiwi === ${JSON.stringify(MOD_PROTOCOL)} && e.data.type === "scene") runScene(e.data.html)
})
`,
);
const built = await Bun.build({ entrypoints: [entry], minify: true, target: "browser" });
if (!built.success) throw new Error(built.logs.join("\n"));
const loader = await built.outputs[0]!.text();

const frameCsp = /content="([^"]+)"/.exec(readFileSync(join(ROOT, "ui/public/mod-frame.html"), "utf8"))![1]!.replaceAll("views:", "'self'");
const frame = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><script src="/loader.js"></script><body></body>`;
const page = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#223056}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style><body></body>`;

const defaultScene = await afkSceneHtml();
const hits: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response(page, { headers: { "content-type": "text/html" } });
    if (path === "/frame.html") return new Response(frame, { headers: { "content-type": "text/html" } });
    if (path === "/loader.js") return new Response(loader, { headers: { "content-type": "text/javascript" } });
    hits.push(path);
    return new Response("reached", { headers: { "access-control-allow-origin": "*" } });
  },
});
const base = `http://127.0.0.1:${server.port}`;

const probe = `<!doctype html><style>body{background:rgb(200 40 40)}</style><body><p id="hi">probe</p><script>
const out = { fetch: "none", image: "none", socket: "none", parent: "none", dom: document.getElementById("hi")?.textContent ?? null, state: null };
addEventListener("message", (e) => { if (e.data?.kiwi === "afk" && e.data.type === "state") out.state = e.data.needs });
(async () => {
  try { await fetch(${JSON.stringify(`${base}/fetch`)}); out.fetch = "reached" } catch { out.fetch = "blocked" }
  await new Promise((done) => { const i = new Image(); i.onload = () => { out.image = "reached"; done() }; i.onerror = () => { out.image = "blocked"; done() }; i.src = ${JSON.stringify(`${base}/image`)} });
  try { const s = new WebSocket(${JSON.stringify(`ws://127.0.0.1:${server.port}/socket`)}); await new Promise((done) => { s.onopen = () => { out.socket = "reached"; done() }; s.onerror = () => { out.socket = "blocked"; done() } }) } catch { out.socket = "blocked" }
  try { out.parent = parent.document.title === undefined ? "blocked" : "reached" } catch { out.parent = "blocked" }
  setTimeout(() => parent.postMessage({ kiwi: "afk", type: "ready", probe: out }, "*"), 300)
})()
</script></body>`;

const failures: string[] = [];
const check = (ok: boolean, said: string): void => {
  console.log(`${ok ? "✓" : "✗"} ${said}`);
  if (!ok) failures.push(said);
};

interface Heard {
  ready: boolean;
  probe: Record<string, unknown> | null;
}

async function show(p: Page, html: string, wait: number): Promise<Heard> {
  return p.evaluate(
    ({ html, wait, kiwi }) =>
      new Promise<Heard>((done) => {
        document.querySelector("iframe")?.remove();
        const f = document.createElement("iframe");
        f.setAttribute("sandbox", "allow-scripts");
        f.src = "/frame.html";
        const heard = (e: MessageEvent): void => {
          if (e.source !== f.contentWindow || e.data?.kiwi !== "afk" || e.data.type !== "ready") return;
          removeEventListener("message", heard);
          done({ ready: true, probe: e.data.probe ?? null });
        };
        addEventListener("message", heard);
        f.onload = () => {
          f.contentWindow?.postMessage({ kiwi, type: "scene", html }, "*");
          f.contentWindow?.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs: 2, still: false }, "*");
        };
        document.body.append(f);
        setTimeout(() => done({ ready: false, probe: null }), wait);
      }),
    { html, wait, kiwi: MOD_PROTOCOL },
  );
}

let browser: Browser | null = null;
try {
  browser = await (ENGINE === "chromium" ? chromium : webkit).launch();
  const p = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);

  const first = await show(p, defaultScene, 30_000);
  check(first.ready, "the default scene, built from the meadow, says it's ready once it draws");
  if (SHOT) await p.screenshot({ path: SHOT });

  const probed = await show(p, probe, 15_000);
  const r = probed.probe ?? {};
  check(probed.ready, "a scene swapped in for the default runs in its place");
  check(r["dom"] === "probe", "its body and styles land in the frame");
  check(r["fetch"] === "blocked" && r["image"] === "blocked" && r["socket"] === "blocked", `it can't reach the network: fetch ${r["fetch"]}, image ${r["image"]}, WebSocket ${r["socket"]}`);
  check(r["parent"] === "blocked", "it can't read the page that frames it");
  check(r["state"] === 2, "it hears the state the app sends: 2 need you");
  check(hits.length === 0, `the server saw no request from a scene${hits.length ? `: ${hits.join(", ")}` : ""}`);

  const broken = await show(p, "<!doctype html><script>throw new Error('a broken scene')</script>", 3_000);
  check(!broken.ready, "a broken scene never says ready, so the app keeps its plain sky");
  const others = errors.filter((e) => !e.includes("a broken scene"));
  check(others.length === 0, `no errors but the broken scene's own${others.length ? `: ${others.join("; ")}` : ""}`);
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`the AFK scene failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("the AFK scene file runs in the mods' frame, draws, hears the app, can't reach the network or the app, and swaps");
