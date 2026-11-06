import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { ASK_AGAIN_URL } from "../src/keyring-wait.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { fillIn, firstChannel, sendMessage } from "./eb-first-run.ts";

if (!process.argv[2]) {
  console.error("usage: bun desktop/scripts/eb-mods-check.ts <the app built with CHANNELS_EB_TEST=1> [screenshot dir]");
  process.exit(2);
}

const exe = appExecutable(process.argv[2]);
const shots = process.argv[3] ?? null;
const root = mkdtempSync(join(tmpdir(), "kiwi-mods-check-"));
const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const problems: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) problems.push(what);
};

const { relay, port } = await startLocalRelay(join(root, "relay"), null, { rateLimits: false });
const RELAY = `http://127.0.0.1:${port}`;
const folder = join(root, ".kiwi", "mods", "probe-mod");
const quietFolder = join(root, ".kiwi", "mods", "quiet-mod");

function writeQuietMod(): void {
  mkdirSync(quietFolder, { recursive: true });
  writeFileSync(join(quietFolder, "mod.json"), JSON.stringify({ name: "quiet-mod", version: "1.0.0", shell: "^3.3", needs: [] }));
  writeFileSync(
    join(quietFolder, "index.tsx"),
    `import { command, messageAction, panel, sidebar } from "@kiwi/mod"

const refused = (f: () => void): string => {
  try {
    f()
    return "ran"
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
const nothing = () => null
const tries = [
  refused(() => panel({ title: "Quiet panel", render: nothing })),
  refused(() => sidebar({ title: "Quiet side", render: nothing })),
  refused(() => command({ id: "x", title: "Quiet command", run: nothing })),
  refused(() => messageAction({ id: "x", title: "Quiet action", run: nothing })),
]
const forged = [
  { type: "panel", title: "Quiet panel" },
  { type: "sidebar", title: "Quiet side" },
  { type: "size", height: 200 },
  { type: "commands", list: [{ id: "x", title: "Quiet command" }] },
  { type: "actions", list: [{ id: "x", title: "Quiet action" }] },
]
setInterval(() => {
  for (const m of forged) parent.postMessage({ kiwi: 1, ...m }, "*")
  parent.postMessage({ kiwiProbe: { quiet: tries } }, "*")
}, 500)
`,
  );
}

function writeMod(version: number): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "mod.json"), JSON.stringify({ name: "probe-mod", version: `1.0.${version}`, shell: "^3.3", needs: ["panel", "sidebar", "command", "message-action", "net:example.com"] }));
  writeFileSync(
    join(folder, "index.tsx"),
    `import { useState } from "react"
import { command, fetch as modFetch, messageAction, panel, sidebar, Button, Row } from "@kiwi/mod"

const surface = document.documentElement.dataset["surface"]
const say = (m: unknown) => parent.postMessage({ kiwiProbe: m }, "*")
addEventListener("message", (e) => {
  if (JSON.stringify(e.data ?? null).includes(["the message", "link"].join(" "))) say({ sawMessage: (e.data as { type?: string } | null)?.type ?? "?", surface })
})
const attempt = async (f: () => unknown): Promise<unknown> => {
  try {
    return await f()
  } catch (e) {
    return "blocked " + (e instanceof Error ? e.name + ": " + e.message : String(e))
  }
}

function View() {
  const [n, setN] = useState(0)
  return (
    <>
      <Row title="Probe mod ${version}" sub="runs in its own frame" />
      <Button kind="primary" onClick={() => setN(n + 1)}>Pressed {n}</Button>
    </>
  )
}

panel({ title: "Probe mod", render: View })
sidebar({ title: "Probe side", render: () => <Row title="Probe side ${version}" /> })
command({ id: "hi", title: "Say hi from the probe mod", run: () => say({ command: "hi" }) })
messageAction({ id: "keep", title: "Keep in the probe mod", run: (m) => say({ action: m, surface }) })

async function probe() {
  const w = window as unknown as Record<string, any>
  const h = w.webkit?.messageHandlers
  const out: Record<string, unknown> = {
    version: ${version},
    origin: String(self.origin),
    kiwi: typeof w.kiwi,
    electrobunBridge: typeof w.__electrobunBunBridge,
    parentDocument: await attempt(() => typeof parent.document),
    storage: await attempt(() => typeof localStorage.length),
    ownFetch: await attempt(async () => (await fetch("https://example.com/"), "reached")),
    relayFetch: await attempt(async () => (await fetch(${JSON.stringify(RELAY)} + "/v1/config"), "reached")),
    listed: await attempt(async () => (await modFetch("https://example.com/")).status),
    unlisted: await attempt(async () => (await modFetch("https://example.org/")).status),
    relayByProxy: await attempt(async () => (await modFetch(${JSON.stringify(RELAY)} + "/v1/config")).status),
    handlers: h ? ["bunBridge", "hostBridge", "internalBridge", "eventBridge"].filter((n) => !!h[n]) : [],
  }
  if (${version} === 1 && h) {
    const event = (id: number, eventName: string, detail: string) => h.eventBridge?.postMessage(JSON.stringify({ id: "webviewEvent", type: "message", payload: { id, eventName, detail } }))
    for (let id = 1; id <= 8; id++) {
      event(id, "new-window-open", "https://example.com/?forged-new-window")
      event(id, "new-window-open", JSON.stringify({ url: "https://example.com/?forged-new-window-json" }))
      event(id, "will-navigate", JSON.stringify({ url: "https://example.com/?forged-refused", allowed: false }))
      event(id, "will-navigate", JSON.stringify({ url: ${JSON.stringify(ASK_AGAIN_URL)}, allowed: false }))
      event(id, "will-navigate", JSON.stringify({ url: "https://example.com/?forged-breach", allowed: true }))
    }
    for (const name of ["bunBridge", "internalBridge"])
      await attempt(() => h[name]?.postMessage(JSON.stringify({ session: "mod", doc: "mod", packet: { id: 1, method: "kiwi.getSnapshot", params: [] } })))
  }
  say(out)
  if (${version} === 1) {
    setTimeout(() => (location.href = "https://example.com/?mod-self-nav"), 300)
    setTimeout(() => say({ stillHere: true }), 2000)
  }
}

if (surface === "main") void probe()
`,
  );
}

const clickText = ({ selector, text }: { selector: string; text: string }): boolean => {
  const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => (e.textContent ?? "").includes(text) && e.getClientRects().length > 0);
  el?.click();
  return !!el;
};

const step = (what: string, ms: number, act: () => Promise<boolean>) =>
  until(what, ms, () =>
    act().then(
      (done) => (done ? true : null),
      () => null,
    ),
  );

const pageNow = (): Record<string, unknown> => ({
  palette: !!document.querySelector(".palette-box"),
  chan: document.querySelector(".chan")?.className ?? null,
  panel: (document.querySelector(".panel")?.outerHTML ?? null)?.slice(0, 2_000),
  dialogs: [...document.querySelectorAll("dialog[open], [role=dialog]")].map((e) => e.className),
  width: innerWidth,
  height: innerHeight,
  text: document.body.innerText.slice(0, 1_500),
});

type Said = Record<string, unknown>;
const heard = (d: Driver): Promise<Said[]> =>
  d.evaluate(
    () => {
      const w = window as unknown as { __modHeard?: Said[]; __modQuiet?: Said };
      return [...(w.__modHeard ?? []), ...(w.__modQuiet ? [w.__modQuiet] : [])];
    },
    null,
    3_000,
  );

async function howHeard(d: Driver, why: string): Promise<void> {
  const start = Date.now();
  const said = await heard(d).catch((e: unknown) => String(e));
  const bytes = typeof said === "string" ? 0 : JSON.stringify(said).length;
  const kinds = typeof said === "string" ? said : Object.entries(said.reduce<Record<string, number>>((n, m) => ({ ...n, [Object.keys(m).join("+")]: (n[Object.keys(m).join("+")] ?? 0) + 1 }), {}));
  const frames = await d
    .evaluate(() => [...document.querySelectorAll("iframe")].map((f) => `${f.title} ${f.style.width}x${f.style.height} ${f.style.visibility || "shown"}`), null, 3_000)
    .catch((e: unknown) => String(e));
  const types = await d.evaluate(() => (window as unknown as { __modTypes?: Record<string, number> }).__modTypes ?? {}, null, 3_000).catch((e: unknown) => String(e));
  const mainStart = Date.now();
  const main = await d.main("browserOpens", 3_000).then(
    () => `answered in ${Date.now() - mainStart} ms`,
    (e: unknown) => String(e),
  );
  console.log(
    `${why}: the page answered in ${Date.now() - start} ms; heard ${JSON.stringify(kinds)} (${bytes} bytes); frames ${JSON.stringify(frames)}; frame messages ${JSON.stringify(types)}; the app's main ${main}`,
  );
}

const MESSAGE_LINK = "https://example.com/?message-link";
const CRASH = "crash-mod fails on purpose";

function writeCrashMod(): void {
  const dir = join(root, ".kiwi", "mods", "crash-mod");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "crash-mod", version: "1.0.0", shell: "^3.3" }));
  writeFileSync(join(dir, "index.tsx"), `throw new TypeError(${JSON.stringify(CRASH)})\n`);
}

type ModNow = { name: string; state: string; off?: string; why?: string };
const modsNow = (d: Driver): Promise<ModNow[]> => d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<ModNow[]> } }).kiwi.mods(), null, 15_000);

async function settingsMods(d: Driver, shows: string): Promise<void> {
  await step("Settings", 10_000, () =>
    d.evaluate(() => (document.querySelector<HTMLElement>(".set-nav") ? true : (document.querySelector<HTMLElement>('[aria-label="Settings"]')?.click(), false)), null, 2_000),
  );
  await step("Settings → Mods", 10_000, () => d.evaluate(clickText, { selector: ".set-nav .side-row", text: "Mods" }, 2_000));
  await step(`Settings → Mods shows "${shows}"`, 15_000, () => d.evaluate((t) => (document.querySelector(".set-main")?.textContent ?? "").includes(t), shows, 2_000)).catch(async (e: unknown) => {
    console.log(`the page then: ${JSON.stringify(await d.evaluate(pageNow, null, 3_000).catch((x: unknown) => String(x)), null, 1)}`);
    throw e;
  });
}

const topAt = (selector: string): { found: boolean; top: string | null } => {
  const el = document.querySelector<HTMLElement>(selector);
  const r = el?.getBoundingClientRect();
  if (!el || !r?.width || !r.height) return { found: false, top: null };
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { found: true, top: at instanceof HTMLIFrameElement ? `frame ${at.title}` : (at?.className ?? null) };
};

const messageMenu = (text: string): string[] | null => {
  const open = document.querySelector(".rail-menu.is-at-pointer");
  if (open) return [...open.querySelectorAll("button")].map((b) => b.textContent ?? "");
  const msg = [...document.querySelectorAll<HTMLElement>(".main article.msg")].find((a) => (a.textContent ?? "").includes(text));
  const body = msg?.querySelector<HTMLElement>(".msg-text") ?? msg;
  const r = body?.getBoundingClientRect();
  if (!body || !r) return null;
  body.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 4, clientY: r.top + 4 }));
  return null;
};

async function clickMessageLink(d: Driver): Promise<void> {
  await step("a message with a link", 30_000, () => d.evaluate(sendMessage, { text: `[the message link](${MESSAGE_LINK})`, shows: "the message link" }, 2_000));
  const clicked = await until("the message's link", 15_000, () =>
    d
      .evaluate(
        (url) => {
          const a = [...document.querySelectorAll<HTMLAnchorElement>(".main article.msg a")].find((el) => el.getAttribute("href") === url);
          if (!a) return null;
          const ev = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
          a.dispatchEvent(ev);
          return { prevented: ev.defaultPrevented };
        },
        MESSAGE_LINK,
        2_000,
      )
      .catch(() => null),
  );
  console.log(`the message link Ctrl-clicked: ${JSON.stringify(clicked)}`);
}

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
    return lstatSync(p).isDirectory() ? files(p) : [p];
  });
}

function stacks(why: string): void {
  if (process.platform !== "darwin" || !app.pid) return;
  const pids = (args: string[]): string[] => (spawnSync("pgrep", args, { encoding: "utf8" }).stdout ?? "").split("\n").filter(Boolean);
  for (const pid of [String(app.pid), ...pids(["-P", String(app.pid)]), ...pids(["-f", "com.apple.WebKit.WebContent"])]) {
    const file = join(root, `sample-${pid}.txt`);
    const run = process.env["CI"]
      ? spawnSync("sudo", ["-n", "sample", pid, "1", "-file", file], { stdio: "ignore", timeout: 20_000 })
      : spawnSync("sample", [pid, "1", "-file", file], { stdio: "ignore", timeout: 20_000 });
    const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
    const name = lines.find((l) => l.startsWith("Process:"))?.replace(/\s+/g, " ") ?? `no sample (exit ${run.status})`;
    const at = lines.findIndex((l) => l.includes("com.apple.main-thread"));
    const total = Number.parseInt(lines[at]?.trim() ?? "", 10);
    const hot: string[] = [];
    for (let i = at + 1; at >= 0 && i < lines.length && lines[i]?.trim() && !/^\s{4}\d+ Thread_/.test(lines[i] ?? ""); i++) {
      const line = (lines[i] ?? "").replace(/^[\s+!:|]*/, "");
      if (Number.parseInt(line, 10) >= total / 2) hot.push(line.slice(0, 180));
    }
    console.log(`${why}: ${name} (${pid}), main thread in ${total} samples:\n  ${hot.join("\n  ")}`);
  }
}

writeMod(1);
writeQuietMod();
let app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY));
try {
  const d = await attach(join(root, "driver.sock"));
  await firstChannel(d, 0);
  await d.evaluate(
    () => {
      const w = window as unknown as { __modHeard?: unknown[]; __modQuiet?: unknown; __modTypes?: Record<string, number> };
      w.__modHeard = [];
      w.__modTypes = {};
      addEventListener("message", (e) => {
        const data = e.data as { kiwiProbe?: unknown; kiwi?: unknown; type?: unknown } | null;
        const m = data?.kiwiProbe;
        if (m && typeof m === "object" && "quiet" in m) w.__modQuiet = m;
        else if (m !== undefined) w.__modHeard?.push(m);
        if (data?.kiwi === 1 && typeof data.type === "string" && w.__modTypes) w.__modTypes[data.type] = (w.__modTypes[data.type] ?? 0) + 1;
      });
      return true;
    },
    null,
    3_000,
  );
  const asks = await d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<{ name: string; state: string; why?: string }[]> } }).kiwi.mods(), null, 15_000);
  console.log(`mods: ${JSON.stringify(asks)}`);
  check(
    asks.some((m) => m.name === "probe-mod" && m.state === "asks"),
    "a new mod waits for the person before it runs",
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
  await step("⌘K", 10_000, palette);
  await step("Set up probe-mod in ⌘K", 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Set up probe-mod" }, 2_000));
  await step("what the mod asks for, in the panel", 10_000, () => d.evaluate(clickText, { selector: ".panel .mod-needs", text: "Talk to example.com" }, 2_000)).catch(async (e: unknown) => {
    console.log(`the page then: ${JSON.stringify(await d.evaluate(pageNow, null, 3_000).catch((x: unknown) => String(x)), null, 1)}`);
    throw e;
  });
  await shot("mod-asks");
  await step("Turn on", 10_000, () => d.evaluate(clickText, { selector: ".panel button", text: "Turn on" }, 2_000));
  const first = await until("the mod's report", 60_000, async () => (await heard(d)).find((m) => m["version"] === 1) ?? null);
  console.log(`the mod saw: ${JSON.stringify(first, null, 1)}`);
  check(first["origin"] === "null", "the mod's frame has an origin of its own (opaque)");
  check(first["kiwi"] === "undefined" && first["electrobunBridge"] === "undefined", "the mod has no window.kiwi and no bridge object");
  check(String(first["parentDocument"]).startsWith("blocked"), "the mod can't read the page");
  check(String(first["storage"]).startsWith("blocked"), "the mod has no storage of the app's");
  check(String(first["ownFetch"]).startsWith("blocked"), "the mod's own fetch reaches nothing");
  check(String(first["relayFetch"]).startsWith("blocked"), "the mod can't reach the relay");
  check(first["listed"] === 200, "the mod reaches the host it listed and the person approved");
  check(String(first["unlisted"]).startsWith("blocked"), "the mod can't reach a host it didn't list");
  check(String(first["relayByProxy"]).startsWith("blocked"), "the mod can't reach the relay through the app either");
  await step("the mod's panel title", 10_000, () => d.evaluate(clickText, { selector: ".panel .panel-title", text: "Probe mod" }, 2_000));
  await shot("mod-panel");
  const sideTop = await until("the mod's sidebar section", 15_000, async () => {
    const t = await d.evaluate(topAt, ".side .mod-side-slot", 2_000);
    return t.found ? t : null;
  }).catch(() => null);
  console.log(`at the sidebar section: ${JSON.stringify(sideTop)}`);
  check(sideTop?.top === "frame probe-mod in the sidebar", "a mod that asked for a sidebar section shows it, drawn by its own frame");
  const titles = await d.evaluate(() => [...document.querySelectorAll(".side .mod-side h3")].map((h) => h.textContent), null, 2_000);
  check(titles.includes("Probe side") && !titles.includes("Quiet side"), "a mod that didn't ask for a sidebar section gets none, even when it posts one");
  const quiet = await until("the quiet mod's report", 15_000, async () => (await heard(d)).find((m) => "quiet" in m) ?? null).catch(() => null);
  console.log(`the quiet mod: ${JSON.stringify(quiet)}`);
  const tries = (quiet?.["quiet"] ?? []) as string[];
  check(tries.length === 4 && tries.every((t) => /^\w+\(\) needs "[a-z-]+" in mod\.json's needs$/.test(t)), "the frame refuses a panel, section, command or message action its mod.json doesn't list");
  const wide = await d.evaluate(topAt, ".panel .mod-slot", 2_000);
  check(wide.top === "frame probe-mod", "the mod's panel is on top where the panel sits beside the chat");
  const narrow = (await d.main("narrowForTest")) as { width: number };
  await until("a narrow window", 10_000, () => d.evaluate(() => (innerWidth <= 1180 ? innerWidth : null), null, 2_000)).catch(() => null);
  await later(500);
  const floating = await d.evaluate(topAt, ".panel .mod-slot", 2_000);
  console.log(`window ${narrow.width} wide, at the panel: ${JSON.stringify(floating)}`);
  check(floating.top === "frame probe-mod", "the mod's panel is on top where the panel floats over the chat, in a window under 1180 px");
  await shot("mod-narrow");
  const still = await until("the mod's frame after it tried to leave", 15_000, async () => (await heard(d)).find((m) => m["stillHere"] === true) ?? null).catch(() => null);
  if (!still) await howHeard(d, "no stillHere");
  check(!!still, "the mod's frame stays where it is when it navigates itself");
  await step("⌘K again", 10_000, palette);
  await step("the mod's command, typed into ⌘K", 10_000, () => d.evaluate(fillIn, { selector: ".palette-input", value: "Say hi" }, 2_000));
  await step("the mod's command in ⌘K", 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Say hi from the probe mod" }, 2_000));
  const hi = await until("the command's run", 10_000, async () => (await heard(d)).find((m) => m["command"] === "hi") ?? null).catch(() => null);
  if (!hi) await howHeard(d, "no hi");
  check(!!hi, "the mod's command runs from ⌘K");
  await step("⌘K once more", 10_000, palette);
  await step("the quiet mod's name, typed into ⌘K", 10_000, () => d.evaluate(fillIn, { selector: ".palette-input", value: "Quiet" }, 2_000));
  await later(1_000);
  const found = await d.evaluate(() => [...document.querySelectorAll(".palette-item")].map((e) => e.textContent ?? ""), null, 2_000);
  console.log(`⌘K for "Quiet": ${JSON.stringify(found)}`);
  check(!found.some((t) => t.includes("Quiet")), "a mod that didn't ask for a panel or commands adds neither to ⌘K, even when it posts them");
  await d.evaluate(() => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })), null, 2_000);
  await d.evaluate(
    () => {
      const a = document.createElement("a");
      a.href = "https://example.com/?page-link";
      a.target = "_blank";
      a.textContent = "a link";
      document.body.append(a);
      a.click();
      a.remove();
      return true;
    },
    null,
    3_000,
  );
  await clickMessageLink(d);
  await howHeard(d, "after the message link");
  check(!(await until("what the mods said", 15_000, () => heard(d))).some((m) => "sawMessage" in m || "action" in m), "no message reaches a mod before the person picks its action");
  const items = await until("the message's menu", 10_000, () => d.evaluate(messageMenu, "the message link", 2_000));
  console.log(`the message's menu: ${JSON.stringify(items)}`);
  check(items.includes("Keep in the probe mod"), "a mod that asked for message actions adds one to a message's menu");
  check(!items.includes("Quiet action"), "a mod that didn't ask for message actions adds none, even when it posts them");
  await shot("mod-message-menu");
  await step("the mod's message action", 10_000, () => d.evaluate(clickText, { selector: ".rail-menu.is-at-pointer button", text: "Keep in the probe mod" }, 2_000));
  const kept = await until("the message, in the mod", 10_000, async () => (await heard(d)).find((m) => "action" in m) ?? null).catch(() => null);
  console.log(`the mod got: ${JSON.stringify(kept)}`);
  const got = (kept?.["action"] ?? {}) as Record<string, unknown>;
  check(String(got["text"]).includes("the message link") && String(got["room"]).startsWith("#") && typeof got["seq"] === "number", "picking the action hands the mod that message, with its room");
  await later(500);
  const saw = (await heard(d)).filter((m) => "sawMessage" in m);
  check(saw.length === 1 && saw[0]?.["sawMessage"] === "action" && saw[0]?.["surface"] === "main", "only that one message reached the mod, and only its main frame");
  const was = await d.evaluate(
    () => {
      const before = document.documentElement.dataset["side"] ?? null;
      document.documentElement.dataset["side"] = "none";
      return before;
    },
    null,
    2_000,
  );
  await later(2_000);
  const hiddenSide = await d.evaluate(topAt, ".side .mod-side-slot", 2_000);
  check(!hiddenSide.found, "with the sidebar hidden, the mod's section and its frame are hidden too");
  const asked = Date.now();
  await heard(d);
  const answered = Date.now() - asked;
  await howHeard(d, "with the sidebar hidden");
  check(answered < 1_000, `the page keeps answering while the mod's sidebar frame is hidden (${answered} ms)`);
  await step("⌘K with the sidebar hidden", 10_000, palette);
  await step("the mod's command, typed again", 10_000, () => d.evaluate(fillIn, { selector: ".palette-input", value: "Say hi" }, 2_000));
  await step("the mod's command, again", 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Say hi from the probe mod" }, 2_000));
  const again = await until("the command's second run", 10_000, async () => ((await heard(d)).filter((m) => m["command"] === "hi").length >= 2 ? true : null)).catch(() => null);
  check(!!again, "the mod's main frame still runs its command while its sidebar frame is hidden");
  await d.evaluate(
    (side) => {
      if (side === null) delete document.documentElement.dataset["side"];
      else document.documentElement.dataset["side"] = side;
      return true;
    },
    was,
    2_000,
  );
  await howHeard(d, "with the sidebar back");
  await later(1_000);
  await howHeard(d, "a second after the sidebar came back");
  writeMod(2);
  await later(3_000);
  await howHeard(d, "3 s after the mod's source changed");
  const second = await until("the mod again, after its source changed", 30_000, async () => (await heard(d)).find((m) => m["version"] === 2) ?? null).catch(() => null);
  if (!second) {
    await howHeard(d, "the mod didn't come back");
    stacks("the mod didn't come back");
  }
  check(!!second, "a saved change reloads the mod");
  await later(1_500);
  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(opens.includes("https://example.com/?page-link"), "with a mod running, the page's own links still open in the browser");
  check(opens.includes(MESSAGE_LINK), "with a mod running, a Ctrl-clicked link in a message still opens in the browser");
  check(!opens.some((u) => /forged|mod-self-nav/.test(u)), "nothing the mod forged or navigated to opened in the browser");
  check(app.exitCode === null && app.signalCode === null, "the app is still running after the mod's forged events");
  writeCrashMod();
  const crashed = await until("crash-mod switched off", 30_000, async () => (await modsNow(d)).find((m) => m.name === "crash-mod" && m.state === "off") ?? null).catch(() => null);
  console.log(`crash-mod: ${JSON.stringify(crashed)}`);
  check(crashed?.off === "crash" && (crashed.why ?? "").includes(CRASH), "a mod that throws as it starts is switched off, with its error as the reason");
  check((await modsNow(d)).find((m) => m.name === "probe-mod")?.state === "on", "the other mods keep running");
  await settingsMods(d, CRASH);
  await shot("settings-mods");
  d.close();
  await stop(app);
  writeFileSync(join(root, ".kiwi", "mods", ".safe-mode"), "");
  app = launch(exe, testEnv(root, join(root, "safe.sock"), RELAY));
  const safe = await attach(join(root, "safe.sock"));
  await step("the channel, in safe mode", 60_000, () => safe.evaluate(() => !!document.querySelector(".chan"), null, 2_000));
  const listed = await modsNow(safe);
  console.log(`mods in safe mode: ${JSON.stringify(listed)}`);
  check(listed.every((m) => m.state !== "on") && listed.find((m) => m.name === "probe-mod")?.off === "safe", "safe mode starts with every mod off, and says why");
  check(!existsSync(join(root, ".kiwi", "mods", ".safe-mode")), "safe mode by .safe-mode lasts one start: the app removes the file");
  await settingsMods(safe, "No mod runs until Channels restarts");
  check((await safe.evaluate(() => document.querySelectorAll('iframe[src*="mod-frame"]').length, null, 2_000)) === 0, "safe mode starts no mod's frame");
  await shot("settings-mods-safe");
  safe.close();
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
  console.log(`FAIL ${problems.at(-1)}`);
  stacks("stuck");
} finally {
  await stop(app);
  await daemonStop(join(root, ".kiwi"), 2_000).catch(() => false);
  relay.kill();
  for (const f of files(join(root, "home"))) {
    if (!/main\.log$/.test(f)) continue;
    const lines = readFileSync(f, "utf8")
      .split("\n")
      .filter((l) => /mod|never left the page|not opening|refused|breach/i.test(l));
    if (lines.length) console.log(`${f}:\n${lines.join("\n")}`);
  }
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: a mod runs in its own frame, reaches only what it listed and the person approved, and can't act as the page");
