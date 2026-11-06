import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/eb-figure-check.ts <the app built with CHANNELS_EB_TEST=1> [screenshot dir]");
  process.exit(2);
}

const exe = appExecutable(process.argv[2]);
const shots = process.argv[3] ?? null;
const root = mkdtempSync(join(tmpdir(), "kiwi-figure-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const MOD = "figure-probe";
const TEXT = "four figures";

function writeMod(): void {
  const dir = join(root, ".kiwi", "mods", MOD);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: MOD, version: "1.0.0", shell: "^3.3", needs: ["render:figure", "net:example.com"] }));
  writeFileSync(
    join(dir, "index.tsx"),
    `import { fetch as modFetch, render } from "@kiwi/mod"

let drawing = false
queueMicrotask(() => {
  if (!drawing)
    void modFetch("https://example.com/").then(
      (r) => parent.postMessage({ kiwiProbe: { mainFetch: r.status } }, "*"),
      (e) => parent.postMessage({ kiwiProbe: { mainFetch: String(e) } }, "*"),
    )
})

const AsyncFunction = (async () => {}).constructor as FunctionConstructor
const INLINE = "html,body{margin:0;height:100%;overflow:hidden;background:transparent} svg{display:block;width:100%;height:100%}"

render("figure", ({ html, full }) => {
  drawing = true
  const page = new DOMParser().parseFromString(html, "text/html")
  for (const el of document.querySelectorAll("link[rel=stylesheet], style")) el.remove()
  const code = [...page.querySelectorAll("script")].flatMap((s) => {
    s.remove()
    return s.src ? [] : [{ module: s.type === "module", text: s.textContent ?? "" }]
  })
  document.head.append(...page.head.querySelectorAll("style"))
  if (!full) document.head.append(Object.assign(document.createElement("style"), { textContent: INLINE }))
  document.body.replaceWith(document.adoptNode(page.body))
  for (const c of code) c.module ? void new AsyncFunction('"use strict";\\n' + c.text)() : new Function(c.text)()
})
`,
  );
}

const SNAPSHOT = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="144" viewBox="0 0 200 80"><rect width="200" height="80" rx="6" fill="#3a3a3a"/><circle cx="100" cy="40" r="30" fill="none" stroke="#999" stroke-width="2"/><line x1="100" y1="40" x2="100" y2="14" stroke="#eee" stroke-width="3"/><text x="8" y="72" fill="#bbb" font-size="10" font-family="sans-serif">snapshot ${n}</text></svg>`;

const DRAW = (n: number) => `
const say = (m) => parent.postMessage({ kiwiProbe: m }, "*")
const needle = document.getElementById("needle")
let turn = 0
const tick = () => {
  turn = (turn + 4) % 360
  needle.setAttribute("transform", "rotate(" + turn + " 100 40)")
  requestAnimationFrame(tick)
}
tick()
say({ drawn: ${n}, wide: innerWidth })
`;

const PROBE = `
const attempt = async (f) => {
  try {
    return await f()
  } catch (e) {
    return "blocked " + (e instanceof Error ? e.name + ": " + e.message : String(e))
  }
}
const w = window
const h = w.webkit?.messageHandlers
const out = {
  figure: true,
  origin: String(self.origin),
  kiwi: typeof w.kiwi,
  electrobunBridge: typeof w.__electrobunBunBridge,
  parentDocument: await attempt(() => typeof parent.document),
  topDocument: await attempt(() => typeof top.document),
  storage: await attempt(() => typeof localStorage.length),
  ownFetch: await attempt(async () => (await fetch("https://example.com/"), "reached")),
  relayFetch: await attempt(async () => (await fetch(${JSON.stringify(RELAY)} + "/v1/config"), "reached")),
  modFetch: await attempt(async () => (await w.__kiwiMod["@kiwi/mod"].fetch("https://example.com/")).status),
  modPanel: await attempt(() => (w.__kiwiMod["@kiwi/mod"].panel({ title: "Figure panel", render: () => null }), "ran")),
  image: await new Promise((r) => {
    const i = new Image()
    i.onload = () => r("loaded")
    i.onerror = () => r("blocked")
    i.src = "https://example.com/favicon.ico"
  }),
  popup: await attempt(() => String(window.open("https://example.com/?figure-popup"))),
  topNav: await attempt(() => {
    top.location.href = "https://example.com/?figure-top-nav"
    return "moved"
  }),
  handlers: h ? ["bunBridge", "hostBridge", "internalBridge", "eventBridge"].filter((n) => !!h[n]) : [],
}
if (h) {
  const event = (id, eventName, detail) => h.eventBridge?.postMessage(JSON.stringify({ id: "webviewEvent", type: "message", payload: { id, eventName, detail } }))
  for (let id = 1; id <= 8; id++) {
    event(id, "new-window-open", "https://example.com/?figure-forged-new-window")
    event(id, "will-navigate", JSON.stringify({ url: "https://example.com/?figure-forged-breach", allowed: true }))
  }
  for (const name of ["bunBridge", "internalBridge"])
    await attempt(() => h[name]?.postMessage(JSON.stringify({ session: "mod", doc: "mod", packet: { id: 1, method: "kiwi.getSnapshot", params: [] } })))
}
say(out)
setTimeout(() => (location.href = "https://example.com/?figure-self-nav"), 300)
setTimeout(() => say({ figureStill: true }), 2000)
`;

const PAGE = (n: number, probe: boolean) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Figure ${n}</title><style>body{margin:0;background:#202020;color:#ddd;font:14px sans-serif}</style></head><body><svg viewBox="0 0 200 80"><rect width="200" height="80" rx="6" fill="#3a3a3a"/><circle cx="100" cy="40" r="30" fill="none" stroke="#999" stroke-width="2"/><line id="needle" x1="100" y1="40" x2="100" y2="14" stroke="#ffcc33" stroke-width="3"/><text x="8" y="72" fill="#ffcc33" font-size="10">live ${n}</text></svg><script type="module">${DRAW(n)}${probe ? PROBE : ""}</script></body></html>`;

const FILES = [1, 2, 3, 4].flatMap((n) => [
  { name: `gauge${n}.figure.html`, type: "text/html", text: PAGE(n, n === 1) },
  { name: `gauge${n}.figure.svg`, type: "image/svg+xml", text: SNAPSHOT(n) },
]);

const clickText = ({ selector, text }: { selector: string; text: string }): boolean => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => (e.textContent ?? "").includes(text) && e.getClientRects().length > 0);
  el?.click();
  return !!el;
};

const attachFiles = (files: { name: string; type: string; text: string }[]): { attached: number; doc: boolean; input: boolean; form: boolean } => {
  const attached = document.querySelectorAll(".main .compose-file").length;
  const doc = !!document.querySelector(".main .thread-doc");
  const form = document.querySelector<HTMLFormElement>(".main form.composer");
  const input = form?.querySelector<HTMLInputElement>("input[type=file]") ?? null;
  if (attached || !doc || !form) return { attached, doc, input: !!input, form: !!form };
  const dt = new DataTransfer();
  for (const f of files) dt.items.add(new File([f.text], f.name, { type: f.type }));
  if (input) {
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else form.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  return { attached, doc, input: !!input, form: true };
};

const figuresNow = (text: string): { shown: number; live: number; chips: number; frames: string[] } => {
  const msg = [...document.querySelectorAll<HTMLElement>(".main article.msg")].find((m) => (m.textContent ?? "").includes(text));
  return {
    shown: msg?.querySelectorAll(".msg-shown").length ?? 0,
    live: msg?.querySelectorAll(".msg-shown.is-live").length ?? 0,
    chips: msg?.querySelectorAll(".msg-file").length ?? 0,
    frames: [...(msg?.querySelectorAll<HTMLIFrameElement>(".msg-shown iframe") ?? [])].map((f) => `${f.title} ${f.getAttribute("sandbox")} ${f.getAttribute("src")}`),
  };
};

const step = (what: string, ms: number, act: () => Promise<boolean>) =>
  until(what, ms, () =>
    act().then(
      (done) => (done ? true : null),
      () => null,
    ),
  );

type Said = Record<string, unknown>;
const heard = (d: Driver): Promise<Said[]> => d.evaluate(() => ((window as unknown as { __modHeard?: Said[] }).__modHeard ?? []) as Said[], null, 3_000);

async function shot(name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  const file = join(shots, `${name}.png`);
  const r = process.platform === "darwin" ? spawnSync("screencapture", ["-x", file], { stdio: "ignore" }) : spawnSync("import", ["-window", "root", file], { stdio: "ignore" });
  console.log(r.status === 0 && existsSync(file) ? `shot ${file}` : `no shot for ${name} here`);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

writeMod();
const app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  await firstChannel(d, 0);
  await d.evaluate(
    () => {
      const w = window as unknown as { __modHeard?: unknown[] };
      w.__modHeard = [];
      addEventListener("message", (e) => {
        const m = (e.data as { kiwiProbe?: unknown } | null)?.kiwiProbe;
        if (m !== undefined) w.__modHeard?.push(m);
      });
      return true;
    },
    null,
    3_000,
  );
  const palette = () =>
    d.evaluate(
      () => {
        if (document.querySelector(".palette-box")) return true;
        const mac = navigator.platform.includes("Mac");
        (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true }));
        return false;
      },
      null,
      2_000,
    );
  await step("the channel", 30_000, () => d.evaluate(() => !!document.querySelector(".chan"), null, 2_000));
  let tried: unknown = null;
  const attached = await until("the four figures, attached", 30_000, async () => {
    const r = await d.evaluate(attachFiles, FILES, 3_000);
    tried = r;
    return r.attached >= FILES.length ? r.attached : null;
  }).catch((e: unknown) => {
    console.log(`the composer then: ${JSON.stringify(tried)}`);
    throw e;
  });
  console.log(`attached ${attached} files`);
  await step("the message with the figures", 60_000, () => d.evaluate(sendMessage, { text: TEXT, shows: TEXT }, 2_000));
  const plain = await until("the figures' files, as chips", 30_000, async () => {
    const now = await d.evaluate(figuresNow, TEXT, 2_000);
    return now.chips === FILES.length ? now : null;
  }).catch(async () => d.evaluate(figuresNow, TEXT, 2_000));
  console.log(`before the mod is on: ${JSON.stringify(plain)}`);
  check(plain.chips === FILES.length && plain.shown === 0, "with no mod on that draws figures, a figure's files are plain file chips");
  await shot("figures-before-the-mod");
  await step("⌘K", 10_000, palette);
  await step(`Set up ${MOD} in ⌘K`, 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: `Set up ${MOD}` }, 2_000));
  await step("what the mod asks for, in the panel", 10_000, () => d.evaluate(clickText, { selector: ".panel .mod-needs", text: "Draw figure attachments in chat, live" }, 2_000));
  await step("and the host it asks for", 10_000, () => d.evaluate(clickText, { selector: ".panel .mod-needs", text: "Talk to example.com" }, 2_000));
  check(true, "a mod that draws figures asks for it, in words, before it runs");
  await shot("figure-mod-asks");
  await step("Turn on", 10_000, () => d.evaluate(clickText, { selector: ".panel button", text: "Turn on" }, 2_000));
  await step("the mod on", 30_000, () =>
    d.evaluate(
      () => (window as unknown as { kiwi: { mods(): Promise<{ name: string; state: string }[]> } }).kiwi.mods().then((l) => l.some((m) => m.name === "figure-probe" && m.state === "on")),
      null,
      15_000,
    ),
  );
  await d.evaluate(() => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), null, 2_000);
  const drawn = await until("the figures, drawn", 60_000, async () => {
    const now = await d.evaluate(figuresNow, TEXT, 2_000);
    return now.shown === 4 && now.live === 3 ? now : null;
  }).catch(async () => d.evaluate(figuresNow, TEXT, 2_000));
  console.log(`the message's figures: ${JSON.stringify(drawn)}`);
  check(drawn.shown === 4 && drawn.chips === 0, "a message's X.figure.html + X.figure.svg pairs show as figures, not file chips");
  await later(3_000);
  const steady = await d.evaluate(figuresNow, TEXT, 2_000);
  check(steady.live === 3 && steady.frames.length === 3, "at most 3 figures are live at once; the 4th shows its snapshot");
  check(
    steady.frames.every((f) => f.endsWith(" allow-scripts views://internal/mod-frame.html")),
    "each live figure is the mod's own sandboxed frame page, never srcdoc",
  );
  const live = (await heard(d)).filter((m) => typeof m["drawn"] === "number").map((m) => m["drawn"] as number);
  console.log(`figures that drew: ${JSON.stringify(live)}`);
  check(new Set(live).size === 3, "the live figures' own scripts run");
  await shot("figures-in-chat");
  const probe = await until("the probe figure's report", 30_000, async () => (await heard(d)).find((m) => m["figure"] === true) ?? null).catch(() => null);
  console.log(`the probe figure saw: ${JSON.stringify(probe, null, 1)}`);
  const p = probe ?? {};
  check(p["origin"] === "null", "a figure has an origin of its own (opaque)");
  check(p["kiwi"] === "undefined" && p["electrobunBridge"] === "undefined", "a figure has no window.kiwi and no bridge object");
  check(String(p["parentDocument"]).startsWith("blocked") && String(p["topDocument"]).startsWith("blocked"), "a figure can't read the page");
  check(String(p["storage"]).startsWith("blocked"), "a figure has no storage of the app's");
  check(String(p["ownFetch"]).startsWith("blocked") && String(p["relayFetch"]).startsWith("blocked"), "a figure's fetch reaches nothing, the relay included");
  const main = (await heard(d)).find((m) => "mainFetch" in m);
  check(main?.["mainFetch"] === 200, "the mod itself reaches example.com, the host it listed and the person approved");
  check(String(p["modFetch"]).startsWith("blocked"), "a figure can't reach the network through its mod, even the host the mod was approved for");
  check(String(p["modPanel"]).startsWith("blocked"), "a figure gets none of its mod's other capabilities");
  check(p["image"] === "blocked", "a figure can't load an image from the network");
  check(p["popup"] === "null" || String(p["popup"]).startsWith("blocked"), "a figure can't open a popup");
  const page = await d.evaluate(() => location.href, null, 2_000);
  check(String(p["topNav"]).startsWith("blocked") || page.startsWith("views://"), "a figure can't navigate the app");
  const still = await until("the probe figure, after it tried to navigate", 10_000, async () => (await heard(d)).find((m) => m["figureStill"] === true) ?? null).catch(() => null);
  check(!!still, "a figure that tries to navigate its own frame stays where it is");
  await step("the full window button", 10_000, () =>
    d.evaluate(
      (text) => {
        const msg = [...document.querySelectorAll<HTMLElement>(".main article.msg")].find((m) => (m.textContent ?? "").includes(text));
        const b = msg?.querySelectorAll<HTMLButtonElement>(".msg-shown-open")[1];
        b?.click();
        return !!b;
      },
      TEXT,
      2_000,
    ),
  );
  const full = await until("the figure, full window", 15_000, async () => {
    const n = (await heard(d)).filter((m) => m["drawn"] === 2 && (m["wide"] as number) > 600).length;
    return n ? n : null;
  }).catch(() => 0);
  const dialog = await d.evaluate(
    () => {
      const el = document.querySelector<HTMLDialogElement>("dialog.shown-full");
      return { open: !!el?.open, frame: el?.querySelector("iframe")?.getAttribute("sandbox") ?? null };
    },
    null,
    2_000,
  );
  console.log(`full window: ${JSON.stringify(dialog)}`);
  check(dialog.open && dialog.frame === "allow-scripts" && full > 0, "a figure opens full window, drawn live in its own frame");
  await shot("figure-full-window");
  await step("close the full window", 10_000, () => d.evaluate(clickText, { selector: "dialog.shown-full button", text: "" }, 2_000));
  await later(1_500);
  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(!opens.some((u) => u.includes("figure-")), "nothing a figure forged, opened or navigated to reached the browser");
  check(app.exitCode === null && app.signalCode === null, "the app is still running after the figure's forged events");
  d.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${problems.at(-1)}`);
} finally {
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.kill();
  for (const f of files(join(root, "home"))) {
    if (!/main\.log$/.test(f)) continue;
    const lines = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /mod|figure|never left the page|not opening|refused|breach/i.test(l));
    if (lines.length) console.log(`${f}:\n${lines.join("\n")}`);
  }
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: an agent's figure draws live in chat, in a frame that reaches neither the network, the bridge nor the page");
