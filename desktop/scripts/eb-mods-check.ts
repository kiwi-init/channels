import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { ASK_AGAIN_URL } from "../src/keyring-wait.ts";
import { appExecutable, attach, launch, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { firstChannel, sendMessage } from "./eb-first-run.ts";

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

function writeMod(version: number): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "mod.json"), JSON.stringify({ name: "probe-mod", version: `1.0.${version}`, shell: "^3.3", needs: ["panel", "command", "net:example.com"] }));
  writeFileSync(
    join(folder, "index.tsx"),
    `import { useState } from "react"
import { command, fetch as modFetch, panel, Button, Row } from "@kiwi/mod"

const say = (m: unknown) => parent.postMessage({ kiwiProbe: m }, "*")
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
command({ id: "hi", title: "Say hi from the probe mod", run: () => say({ command: "hi" }) })

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

void probe()
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

writeMod(1);
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
  const asks = await d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<{ name: string; state: string; needs: string[] }[]> } }).kiwi.mods(), null, 15_000);
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
  const still = await until("the mod's frame after it tried to leave", 15_000, async () => (await heard(d)).find((m) => m["stillHere"] === true) ?? null).catch(() => null);
  check(!!still, "the mod's frame stays where it is when it navigates itself");
  await step("⌘K again", 10_000, palette);
  await step("the mod's command in ⌘K", 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Say hi from the probe mod" }, 2_000));
  const hi = await until("the command's run", 10_000, async () => (await heard(d)).find((m) => m["command"] === "hi") ?? null).catch(() => null);
  check(!!hi, "the mod's command runs from ⌘K");
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
  const messageLink = "https://example.com/?message-link";
  await step("a message with a link", 30_000, () => d.evaluate(sendMessage, { text: `[the message link](${messageLink})`, shows: "the message link" }, 2_000));
  const clicked = await d.evaluate(
    (url) => {
      const a = [...document.querySelectorAll<HTMLAnchorElement>(".main article.msg a")].find((el) => el.getAttribute("href") === url);
      a?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
      return a ? { class: a.className, inEditor: !!a.closest(".ProseMirror"), editable: a.closest("[contenteditable]")?.getAttribute("contenteditable") ?? null } : null;
    },
    messageLink,
    3_000,
  );
  console.log(`the message link Ctrl-clicked: ${JSON.stringify(clicked)}`);
  writeMod(2);
  const second = await until("the mod again, after its source changed", 30_000, async () => (await heard(d)).find((m) => m["version"] === 2) ?? null).catch(() => null);
  check(!!second, "a saved change reloads the mod");
  await later(1_500);
  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(opens.includes("https://example.com/?page-link"), "with a mod running, the page's own links still open in the browser");
  check(opens.includes(messageLink), "with a mod running, a Ctrl-clicked link in a message still opens in the browser");
  check(!opens.some((u) => /forged|mod-self-nav/.test(u)), "nothing the mod forged or navigated to opened in the browser");
  check(app.exitCode === null && app.signalCode === null, "the app is still running after the mod's forged events");
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
      .filter((l) => /mod|never left the page|not opening|refused|breach/i.test(l));
    if (lines.length) console.log(`${f}:\n${lines.join("\n")}`);
  }
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) process.exit(1);
console.log("ok: a mod runs in its own frame, reaches only what it listed and the person approved, and can't act as the page");
