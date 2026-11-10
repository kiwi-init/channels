import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { folderHash } from "@kiwi/core/node/mod-folder.ts";

import { startLocalRelay } from "../../scripts/local-relay.ts";
import { addMod } from "../../src/mods.ts";
import { daemonStop } from "../src/daemon-client.ts";
import { ASK_AGAIN_URL } from "../src/keyring-wait.ts";
import { appExecutable, attach, launch, screenshot, stop, testEnv, until, type Driver } from "./eb-drive.ts";
import { fillIn, firstChannel, sendMessage } from "./eb-first-run.ts";
import { tiling } from "./tiling.ts";

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
const posterFolder = join(root, ".kiwi", "mods", "poster-probe");
const readerFolder = join(root, ".kiwi", "mods", "reader-probe");
const terminalFolder = join(root, ".kiwi", "mods", "terminal-mod");
const TMUX_CONF = join(root, "home", ".tmux.conf");
const REX_INIT = join(root, "home", ".config", "rex", "init.lua");
const TMUX_BEFORE = "set -g mouse on\nbind r source-file ~/.tmux.conf";
const CATALOG_COMMIT = "c".repeat(40);
const catalogSource = join(root, "catalog");
const catalogFiles: Record<string, Record<string, string | Uint8Array>> = {
  "catalog-mod": {
    "mod.json": JSON.stringify({ name: "catalog-mod", version: "1.0.0", shell: "^3.3", needs: ["panel"] }),
    "index.tsx": `import { panel } from "@kiwi/mod"\npanel({ title: "Catalog", render: () => null })\n`,
    "README.md": "# Catalog mod\n\nIt shows that a store page reads its README.\n",
    "media/1-panel.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
    "media/2-liar.png": "not a picture",
  },
  "tampered-mod": {
    "mod.json": JSON.stringify({ name: "tampered-mod", version: "1.0.0", shell: "^3.3", needs: [] }),
    "index.tsx": `parent.postMessage({ kiwiProbe: { tamperedRan: true } }, "*")\n`,
  },
};
for (const [name, files] of Object.entries(catalogFiles))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(catalogSource, name, file)), { recursive: true });
    writeFileSync(join(catalogSource, name, file), text);
  }
const catalogIndex = {
  mods: Object.entries(catalogFiles).map(([name, files]) => ({
    name,
    does: name === "catalog-mod" ? "Shows that the catalog installs" : "Is served changed after it was vouched for",
    needs: JSON.parse(String(files["mod.json"])).needs as string[],
    commit: CATALOG_COMMIT,
    hash: folderHash(join(catalogSource, name)),
    files: Object.keys(files),
  })),
};
writeFileSync(join(catalogSource, "tampered-mod", "index.tsx"), `parent.postMessage({ kiwiProbe: { tamperedRan: "changed" } }, "*")\n`);
const catalogServer = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path === "/kiwi-init/mods/main/mods.json") return Response.json(catalogIndex);
    const prefix = `/kiwi-init/mods/${CATALOG_COMMIT}/`;
    const rel = path.startsWith(prefix) ? path.slice(prefix.length) : "";
    return rel && !rel.split("/").includes("..") && existsSync(join(catalogSource, rel)) ? new Response(readFileSync(join(catalogSource, rel))) : new Response("nope", { status: 404 });
  },
});
const TERMINAL_ENV = { KIWI_TMUX_CONF: TMUX_CONF, REX_CONFIG: REX_INIT, XDG_CONFIG_HOME: join(root, "home", ".config"), KIWI_EB_MODS_RAW: `http://127.0.0.1:${catalogServer.port}` };

function writeTerminalMod(): void {
  mkdirSync(join(terminalFolder, "terminal"), { recursive: true });
  writeFileSync(join(terminalFolder, "mod.json"), JSON.stringify({ name: "terminal-mod", version: "1.0.0", shell: "^3.9", needs: ["terminal"] }));
  writeFileSync(join(terminalFolder, "terminal", "tmux.conf"), 'set -g status-right "#{@kiwi} %H:%M"\nbind K display-message "Kiwi"\n');
  writeFileSync(join(terminalFolder, "terminal", "rex.lua"), 'rex.log("kiwi terminal-mod")\n');
  writeFileSync(
    join(terminalFolder, "index.tsx"),
    `import { terminals } from "@kiwi/mod"

terminals().then(
  (list) => parent.postMessage({ kiwiProbe: { terminals: list } }, "*"),
  (e: unknown) => parent.postMessage({ kiwiProbe: { terminals: e instanceof Error ? e.message : String(e) } }, "*"),
)
`,
  );
}

const settingsFolder = join(root, ".kiwi", "mods", "settings-mod");
const SECRET = `sk-settings-mod-${Math.random().toString(36).slice(2)}`;

function writeSettingsMod(): void {
  mkdirSync(settingsFolder, { recursive: true });
  const settings = [
    { id: "token", title: "Token", type: "secret", required: true },
    { id: "mode", title: "Mode", type: "choice", choices: ["fast", "slow"] },
  ];
  writeFileSync(join(settingsFolder, "mod.json"), JSON.stringify({ name: "settings-mod", version: "1.0.0", shell: "^3.3", needs: [], settings }));
  writeFileSync(join(settingsFolder, "index.tsx"), `import { settings } from "@kiwi/mod"\nparent.postMessage({ kiwiProbe: { settingsMod: settings() } }, "*")\n`);
}

function writePosterMod(): void {
  mkdirSync(posterFolder, { recursive: true });
  writeFileSync(join(posterFolder, "mod.json"), JSON.stringify({ name: "poster-probe", version: "1.0.0", shell: "^3.16", needs: ["post:#general"] }));
  writeFileSync(
    join(posterFolder, "index.tsx"),
    `import { post, rooms } from "@kiwi/mod"

const tried = (m: { channel: string; room: string; text: string }) => post(m).then(() => "ok", (e: unknown) => (e instanceof Error ? e.message : String(e)))
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))
let started = false
setInterval(async () => {
  const list = rooms()
  if (started || !list.length) return
  started = true
  const here = list[0]
  const first = await tried({ channel: here.channel, room: here.room, text: "hello from the poster probe" })
  const soon = await tried({ channel: here.channel, room: here.room, text: "a second post too soon" })
  await pause(2_100)
  const otherRoom = await tried({ channel: here.channel, room: "secret", text: "a post into a room it never asked for" })
  const otherChannel = await tried({ channel: "not-one-of-mine", room: "general", text: "a post into a channel it wasn't given" })
  parent.postMessage({ kiwiProbe: { poster: { rooms: list, first, soon, otherRoom, otherChannel } } }, "*")
}, 300)
`,
  );
}

async function posts(d: Driver): Promise<void> {
  writePosterMod();
  await d.evaluate(() => (document.querySelector<HTMLElement>(".rail-mods")?.click(), true), null, 2_000);
  await step("the channel, for the posting mod", 10_000, () => d.evaluate(() => !!document.querySelector(".chan") && !document.querySelector('.rail-mods[aria-current="page"]'), null, 2_000));
  const ask = await until("poster-probe's ask, by itself", 30_000, () =>
    d.evaluate(
      () => {
        const box = document.querySelector('dialog[open][aria-label="poster-probe asks to run"]');
        if (!box) return null;
        const here = document.querySelector('nav[aria-label="Channels"] button[aria-current="page"]')?.getAttribute("aria-label") ?? null;
        const ticked = [...box.querySelectorAll(".mod-room")].filter((l) => l.querySelector("input")?.checked).map((l) => l.textContent?.trim() ?? "");
        const offered = box.querySelectorAll(".mod-room").length;
        return { here, ticked, offered, words: box.querySelector(".mod-needs")?.textContent ?? "" };
      },
      null,
      2_000,
    ),
  ).catch(() => null);
  console.log(`poster-probe's ask: ${JSON.stringify(ask)}`);
  check(!!ask && ask.words.includes("Post in #general") && ask.offered >= 1, "a mod that asks to post in #general lists your channels with #general in its ask");
  check(!!ask?.here && JSON.stringify(ask.ticked) === JSON.stringify([ask.here]), "the channel you're in starts ticked, and only it");
  await later(300);
  await shot("mod-asks-rooms");
  await step("Allow, for the posting mod", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Allow" }, 2_000));
  const said = await until("poster-probe's report", 30_000, async () => ((await heard(d)).find((m) => "poster" in m)?.["poster"] as Record<string, unknown> | undefined) ?? null).catch(() => null);
  console.log(`poster-probe saw: ${JSON.stringify(said)}`);
  const granted = (said?.["rooms"] ?? []) as { channel: string; title: string; room: string }[];
  check(granted.length === 1 && granted[0]?.room === "general" && granted[0]?.title === ask?.here, "the mod is told only the room you ticked, with its channel's title");
  check(said?.["first"] === "ok", "it posts into #general of the channel you ticked");
  check(String(said?.["soon"]).includes("at most once every 2 seconds"), "a second post within 2 s is refused");
  check(String(said?.["otherRoom"]).includes("may not post"), "a post into a room it never asked for is refused");
  check(String(said?.["otherChannel"]).includes("may not post"), "a post into a channel you didn't tick is refused");
  const landed = await until("the mod's post in the channel", 15_000, () =>
    d.evaluate(
      () => {
        const text = document.querySelector(".chan")?.textContent ?? "";
        return text.includes("hello from the poster probe") ? text : null;
      },
      null,
      2_000,
    ),
  ).catch(() => null);
  check(!!landed && landed.includes("via poster-probe"), "its post lands in the channel, ending with “via poster-probe”");
  check(!!landed && !/too soon|never asked for|wasn't given/.test(landed), "no refused post reaches the channel");
  await shot("mod-posted");
}

function writeReaderMod(): void {
  mkdirSync(readerFolder, { recursive: true });
  writeFileSync(join(readerFolder, "mod.json"), JSON.stringify({ name: "reader-probe", version: "1.0.0", shell: "^3.18", needs: ["read:#general", "read:#ops"] }));
  writeFileSync(
    join(readerFolder, "index.tsx"),
    `import { messages, rooms } from "@kiwi/mod"

let last = ""
setInterval(() => {
  const list = rooms()
  const here = list[0]?.channel ?? ""
  const lines = (room: string) => (here ? messages(here, room).map((m) => m.author + ": " + m.text) : [])
  const reader = { rooms: list, general: lines("general"), ops: lines("ops") }
  const said = JSON.stringify(reader)
  if (said === last) return
  last = said
  parent.postMessage({ kiwiProbe: { reader } }, "*")
}, 300)
`,
  );
}

async function reads(d: Driver): Promise<void> {
  if (!botIn) await letBotIn(d);
  await step("New room", 10_000, () =>
    d.evaluate(() => (document.querySelector<HTMLElement>('button[aria-label="New room"]')?.click(), !!document.querySelector('dialog[open][aria-label="New room"]')), null, 2_000),
  );
  await step("the room's name", 10_000, () =>
    d.evaluate(
      () => {
        const input = document.querySelector<HTMLInputElement>('dialog[open] input[aria-label="Room name"]');
        if (!input) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "ops");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      },
      null,
      2_000,
    ),
  );
  await step("Create room", 15_000, () => d.evaluate(clickText, { selector: "dialog[open] button", text: "Create room" }, 2_000));
  await step("#ops in the channel", 20_000, () => d.evaluate(() => [...document.querySelectorAll('section[aria-label="Rooms"] .side-label')].some((l) => l.textContent === "ops"), null, 2_000));
  await step("back to #general, for the reading mod", 10_000, () => d.evaluate(clickText, { selector: 'section[aria-label="Rooms"] button', text: "general" }, 2_000));
  await bot(["-c", "mods", "--as", "bot", "send", "general, before the reader"]);
  await bot(["-c", "mods", "--as", "bot", "send", "--to", "#ops", "ops, before the reader"]);
  writeReaderMod();
  const ask = await until("reader-probe's ask", 30_000, () =>
    d.evaluate(
      () => {
        const box = document.querySelector('dialog[open][aria-label="reader-probe asks to run"]');
        if (!box) return null;
        const groups = [...box.querySelectorAll("fieldset.mod-room-group")].map((g) => ({
          room: g.querySelector("legend")?.textContent ?? "",
          ticked: [...g.querySelectorAll("input")].filter((i) => (i as HTMLInputElement).checked).length,
        }));
        return { groups, words: box.querySelector(".mod-needs")?.textContent ?? "" };
      },
      null,
      2_000,
    ),
  ).catch(() => null);
  console.log(`reader-probe's ask: ${JSON.stringify(ask)}`);
  check(!!ask && ask.words.includes("Read #general") && ask.words.includes("Read #ops"), "a mod that asks to read #general and #ops names both rooms in its ask");
  await step("untick #ops", 10_000, () =>
    d.evaluate(
      () => {
        const ops = [...document.querySelectorAll("dialog[open] fieldset.mod-room-group")].find((g) => g.querySelector("legend")?.textContent === "#ops in");
        const box = ops?.querySelector<HTMLInputElement>("input");
        if (box?.checked) box.click();
        return !!box && !box.checked;
      },
      null,
      2_000,
    ),
  );
  await later(300);
  await shot("mod-asks-read");
  await step("Allow, for the reading mod", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Allow" }, 2_000));
  const report = (): Promise<{ rooms: { room: string }[]; general: string[]; ops: string[] } | null> =>
    heard(d).then((all) => (all.filter((m) => "reader" in m).at(-1)?.["reader"] as { rooms: { room: string }[]; general: string[]; ops: string[] } | undefined) ?? null);
  const before = await until("the reader's history of #general", 30_000, async () => {
    const r = await report();
    return r?.general.includes("bot: general, before the reader") ? r : null;
  }).catch(() => report());
  console.log(`reader-probe saw first: ${JSON.stringify(before)}`);
  check(JSON.stringify(before?.rooms.map((r) => r.room)) === JSON.stringify(["general"]), "the reading mod is told only the room you left ticked");
  check(!!before?.general.includes("bot: general, before the reader"), "it gets #general's messages from before you allowed it");
  await bot(["-c", "mods", "--as", "bot", "send", "general, after the reader"]);
  await bot(["-c", "mods", "--as", "bot", "send", "--to", "#ops", "ops, after the reader"]);
  const after = await until("the reader's live #general", 30_000, async () => {
    const r = await report();
    return r?.general.includes("bot: general, after the reader") ? r : null;
  }).catch(() => report());
  console.log(`reader-probe saw then: ${JSON.stringify(after)}`);
  check(!!after?.general.includes("bot: general, after the reader"), "a new message in #general reaches it as it comes");
  const leaked = (await heard(d)).some((m) => JSON.stringify(m["reader"] ?? "").includes("ops, "));
  check(!leaked && !!after && after.ops.length === 0, "nothing from #ops, the room you unticked, ever reaches it");
}

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
  writeFileSync(
    join(folder, "mod.json"),
    JSON.stringify({ name: "probe-mod", version: `1.0.${version}`, shell: "^3.3", needs: ["panel", "sidebar", "command", "message-action", "net:example.com"], icon: "icon.svg" }),
  );
  writeFileSync(join(folder, "icon.svg"), ICON);
  writeFileSync(
    join(folder, "index.tsx"),
    `import { useState } from "react"
import { command, fetch as modFetch, messageAction, panel, settings, sidebar, Button, Row } from "@kiwi/mod"

const surface = document.documentElement.dataset["surface"]
const say = (m: unknown) => parent.postMessage({ kiwiProbe: m }, "*")
addEventListener("message", (e) => {
  if (JSON.stringify(e.data ?? null).includes(["the message", "link"].join(" "))) say({ sawMessage: (e.data as { type?: string } | null)?.type ?? "?", surface })
})
addEventListener("message", (e) => {
  const settle = (e.data as { floodSizes?: number } | null)?.floodSizes
  if (surface !== "sidebar" || typeof settle !== "number") return
  const stop = Date.now() + 2_000
  let n = 0
  const burst = () => {
    for (let i = 0; i < 400; i++) parent.postMessage({ kiwi: 1, type: "size", height: n++ % 2 ? 40 : 300 }, "*")
    if (Date.now() < stop) return void setTimeout(burst, 0)
    parent.postMessage({ kiwi: 1, type: "size", height: settle }, "*")
    say({ flooded: n })
  }
  burst()
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
    settings: settings(),
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
      event(id, "dom-ready", "https://example.com/?forged-dom-ready")
      event(id, "host-message", JSON.stringify({ forged: "host-message" }))
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

const kitFolder = join(root, ".kiwi", "mods", "kit-mod");

function writeKitMod(version: number): void {
  mkdirSync(kitFolder, { recursive: true });
  writeFileSync(join(kitFolder, "mod.json"), JSON.stringify({ name: "kit-mod", version: `1.0.${version}`, shell: "^3.3", needs: ["panel"] }));
  writeFileSync(
    join(kitFolder, "index.tsx"),
    `import { useEffect, useState } from "react"
import { Action, Actions, List, panel, storage, Toast } from "@kiwi/mod"

const say = (m: Record<string, unknown>) => parent.postMessage({ kiwiProbe: { kit: true, ...m } }, "*")
const input = () => document.querySelector<HTMLInputElement>(".palette-input")
const rows = () => [...document.querySelectorAll(".palette-item .palette-label")].map((e) => e.firstChild?.textContent ?? "")
const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

addEventListener("message", async (e) => {
  const t = e.source === parent && e.data && typeof e.data.kitTest === "string" ? e.data.kitTest : null
  const el = input()
  if (!t || !el) return
  if (t === "search") {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, String(e.data.q))
    el.dispatchEvent(new Event("input", { bubbles: true }))
  } else el.dispatchEvent(new KeyboardEvent("keydown", { key: t === "enter" ? "Enter" : "Escape", bubbles: true, cancelable: true }))
  await settle()
  say({ test: t, rows: rows() })
})

function View() {
  const [visits, setVisits] = useState<number | null>(null)
  useEffect(() => {
    storage.get<number>("visits").then(
      async (n) => {
        const next = (n ?? 0) + 1
        await storage.set("visits", next)
        setVisits(next)
        say({ visits: next, version: ${version} })
      },
      (e: unknown) => say({ storageFailed: String(e) }),
    )
  }, [])
  return (
    <List searchBarPlaceholder="Search the kit">
      <List.Section title="Today">
        <List.Item
          title="Alpha release"
          subtitle="KIT-1"
          icon="tasks"
          keywords={["first"]}
          accessories={[{ tag: "open" }, { date: Date.now() - 3_600_000 }]}
          actions={
            <Actions>
              <Action title="Pick Alpha" onAction={() => Toast.show({ title: "Picked Alpha" })} />
              <Action.CopyToClipboard content="KIT-1" shortcut="mod+shift+c" />
            </Actions>
          }
        />
        <List.Item
          title="Beta notes"
          subtitle="KIT-2"
          icon="spec"
          accessories={[{ text: \`visit \${visits ?? "…"}\` }]}
          actions={
            <Actions>
              <Action title="Pick Beta" onAction={() => Toast.show({ title: "Picked Beta", style: "success" })} />
            </Actions>
          }
        />
      </List.Section>
      <List.Section title="Later">
        <List.Item title="Gamma plan" subtitle="KIT-3" icon="github" accessories={[{ tag: "draft" }]} />
      </List.Section>
    </List>
  )
}

panel({ title: "Kit mod", render: View })
`,
  );
}

const botHome = join(root, "bot");

function bot(args: string[]): Promise<string> {
  mkdirSync(join(botHome, "bin"), { recursive: true });
  for (const opener of ["open", "xdg-open"]) {
    writeFileSync(join(botHome, "bin", opener), "#!/bin/sh\nexit 0\n");
    chmodSync(join(botHome, "bin", opener), 0o755);
  }
  const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(botHome, "home"), CLAUDE_CONFIG_DIR: join(botHome, "no-claude"), PATH: `${join(botHome, "bin")}:${process.env.PATH}` };
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: join(import.meta.dir, "..", ".."), env });
  let out = "";
  const on = (b: Buffer) => void (out += b.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ").slice(0, 60)} exited ${code}: ${out.trim().split("\n").pop()}`)))));
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

async function letBotIn(d: Driver): Promise<void> {
  await step("Invite people", 10_000, () => d.evaluate(clickText, { selector: "button", text: "Invite people" }, 2_000));
  const code = await until("the invite code", 15_000, () =>
    d.evaluate(() => /mc2-[\w-]+/.exec([...document.querySelectorAll("[role=dialog] code")].map((c) => c.textContent ?? "").join(" "))?.[0] ?? null, null, 2_000),
  );
  await step("the invite closes", 10_000, () =>
    d.evaluate(
      () => {
        const open = document.querySelector<HTMLElement>('dialog[open][aria-label="Invite people"]');
        open?.querySelector<HTMLElement>('button[aria-label="Close"]')?.click();
        return !open;
      },
      null,
      2_000,
    ),
  );
  let joined: true | string | null = null;
  void bot(["join", code, "mods", "--relay", `${RELAY}/`, "--as", "bot"]).then(
    () => (joined = true),
    (e: unknown) => (joined = String(e)),
  );
  await until("letting the bot in", 90_000, async () => {
    if (joined !== null) return joined;
    await d
      .evaluate(
        () => {
          const views = document.querySelector('nav[aria-label="Views"]');
          const needs = [...(views?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").startsWith("Needs you"));
          if (needs && needs.getAttribute("aria-pressed") !== "true") needs.click();
          [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").startsWith("It matches: let") && !b.disabled)?.click();
          return true;
        },
        null,
        2_000,
      )
      .catch(() => false);
    await later(250);
    return null;
  }).then((r) => {
    if (r !== true) throw new Error(`the bot couldn't join: ${r}`);
  });
  await step("back to #general", 10_000, () => d.evaluate(clickText, { selector: 'nav[aria-label="Views"] button', text: "general" }, 2_000));
  botIn = true;
}

let botIn = false;

async function whileAway(d: Driver, palette: () => Promise<boolean>): Promise<void> {
  await letBotIn(d);
  const helpers: ChildProcess[] = [];
  const away = desk
    ? [
        {
          how: "with another window focused",
          put: async () => {
            helpers.push(desk.open("kiwi-away"));
            return until("another window focused", 15_000, async () => (desk.focused() === "kiwi-away" ? true : null)).catch(() => false);
          },
        },
        {
          how: "on another workspace",
          put: async () => {
            for (const h of helpers) h.kill();
            desk.workspace(2);
            return until("an empty workspace in front", 10_000, async () => (desk.focused() === "" ? true : null)).catch(() => false);
          },
        },
      ]
    : [
        {
          how: "with another app in front",
          put: async () => {
            spawnSync("open", ["-a", "Finder", root]);
            return until("another app in front", 10_000, async () => (front().includes("Channels") ? null : true)).catch(() => false);
          },
        },
        {
          how: "minimized",
          put: async () => {
            await d.main("minimizeForTest");
            const shown = await until("the window minimized", 10_000, async () => {
              const w = (await d.main("window")) as { minimized?: unknown };
              return w.minimized === true ? w : null;
            }).catch(async () => d.main("window"));
            console.log(`minimized: the window says ${JSON.stringify(shown)}`);
            return (shown as { minimized?: unknown }).minimized === true;
          },
        },
      ];
  for (const { how, put } of away) {
    check(await put(), `the window can be put away, ${how}${front()}`);
    await later(10_000);
    const text = `from the bot, ${how}, at ${Date.now()}`;
    const sending = Date.now();
    await bot(["-c", "mods", "--as", "bot", "send", text]);
    const sent = Date.now();
    const shown = await until(`the bot's message, ${how}`, 20_000, () =>
      d.evaluate((t) => ([...document.querySelectorAll(".main article.msg")].some((m) => (m.textContent ?? "").includes(t)) ? true : null), text, 2_000),
    ).then(
      () => Date.now() - sent,
      () => null,
    );
    console.log(`${how}: the bot's message showed ${shown ?? "never"} ms after its send returned (the send took ${sent - sending} ms)${front()}`);
    check(shown !== null, `a message from another member shows in the window ${how}`);
    const before = (await heard(d)).filter((m) => m["command"] === "hi").length;
    await step(`⌘K ${how}`, 10_000, palette);
    await step(`the mod's command, typed ${how}`, 10_000, () => d.evaluate(fillIn, { selector: ".palette-input", value: "Say hi" }, 2_000));
    await step(`the mod's command, ${how}`, 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Say hi from the probe mod" }, 2_000));
    const ran = Date.now();
    const answered = await until(`the mod's answer, ${how}`, 10_000, async () => ((await heard(d)).filter((m) => m["command"] === "hi").length > before ? true : null)).then(
      () => Date.now() - ran,
      () => null,
    );
    console.log(`${how}: the mod's frame answered its command ${answered ?? "never"} ms after it was picked${front()}`);
    check(answered !== null, `a mod's frame answers ${how}`);
  }
  if (desk) {
    for (const h of helpers) h.kill();
    desk.workspace(1);
    return;
  }
  await d.main("unminimizeForTest");
  await d.main("activate");
}

const pageNow = (): Record<string, unknown> => ({
  palette: !!document.querySelector(".palette-box"),
  chan: document.querySelector(".chan")?.className ?? null,
  panel: (document.querySelector(".panel")?.outerHTML ?? null)?.slice(0, 2_000),
  dialogs: [...document.querySelectorAll("dialog[open], [role=dialog]")].map((e) => e.className),
  width: innerWidth,
  height: innerHeight,
  text: document.body.innerText.slice(0, 1_500),
});

const desk = tiling();

function front(): string {
  if (desk) return `; in front: ${desk.focused() || "nothing"}`;
  if (process.platform !== "darwin") return "";
  const asn = (spawnSync("lsappinfo", ["front"], { encoding: "utf8" }).stdout ?? "").trim();
  const info = asn ? (spawnSync("lsappinfo", ["info", "-only", "name", asn], { encoding: "utf8" }).stdout ?? "") : "";
  return `; in front: ${/"LSDisplayName"="([^"]*)"/.exec(info)?.[1] ?? (asn || "nothing")}`;
}

type BridgeEvent = { name: string; detail: string };
const bridgeEvents = async (d: Driver): Promise<BridgeEvent[]> => {
  const got = await d.main("bridgeEvents");
  return Array.isArray(got) ? got.flatMap((e: unknown) => (typeof e === "object" && e !== null && "name" in e && "detail" in e ? [{ name: String(e.name), detail: String(e.detail) }] : [])) : [];
};

const PAGE_EVENTS = ["host-message", "dom-ready"];
const postFromPage = (d: Driver): Promise<{ posted: boolean; webviewId: unknown; sendToHost: boolean }> =>
  d.evaluate(
    (names) => {
      const w = window as unknown as {
        webkit?: { messageHandlers?: Record<string, { postMessage(s: string): void } | undefined> };
        __electrobunWebviewId?: number;
        __electrobunEventBridge?: { postMessage(s: string): void };
        __electrobunSendToHost?: (m: unknown) => void;
      };
      const bridge = w.__electrobunEventBridge ?? w.webkit?.messageHandlers?.["eventBridge"];
      const sendToHost = typeof w.__electrobunSendToHost === "function";
      if (!bridge || w.__electrobunWebviewId === undefined) return { posted: false, webviewId: w.__electrobunWebviewId ?? null, sendToHost };
      for (const eventName of names) bridge.postMessage(JSON.stringify({ id: "webviewEvent", type: "message", payload: { id: w.__electrobunWebviewId, eventName, detail: `page-${eventName}` } }));
      w.__electrobunSendToHost?.({ page: "send-to-host" });
      return { posted: true, webviewId: w.__electrobunWebviewId, sendToHost };
    },
    PAGE_EVENTS,
    2_000,
  );

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
    `${why}: the page answered in ${Date.now() - start} ms; heard ${JSON.stringify(kinds)} (${bytes} bytes); frames ${JSON.stringify(frames)}; frame messages ${JSON.stringify(types)}; the app's main ${main}${front()}`,
  );
}

const MESSAGE_LINK = "https://example.com/?message-link";
const ICON_RAN = `top.__iconRan = 1; parent.postMessage({ kiwiProbe: { iconRan: true } }, "*")`;
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onload='${ICON_RAN}'><script>${ICON_RAN}</script><rect width="64" height="64" rx="14" fill="#9188c4"/></svg>`;
const CRASH = "crash-mod fails on purpose";

function writeCrashMod(): void {
  const dir = join(root, ".kiwi", "mods", "crash-mod");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "crash-mod", version: "1.0.0", shell: "^3.3" }));
  writeFileSync(join(dir, "index.tsx"), `throw new TypeError(${JSON.stringify(CRASH)})\n`);
}

type ModNow = { name: string; version?: string | null; state: string; off?: string; why?: string };
const modsNow = (d: Driver): Promise<ModNow[]> => d.evaluate(() => (window as unknown as { kiwi: { mods(): Promise<ModNow[]> } }).kiwi.mods(), null, 15_000);

const NOTES = join(root, "notes-src");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "check", GIT_AUTHOR_EMAIL: "check@example.com", GIT_COMMITTER_NAME: "check", GIT_COMMITTER_EMAIL: "check@example.com" };

function notesVersion(version: string, needs: string[]): void {
  mkdirSync(NOTES, { recursive: true });
  writeFileSync(join(NOTES, "mod.json"), JSON.stringify({ name: "notes-mod", version, shell: "^3.3", needs }));
  writeFileSync(join(NOTES, "index.tsx"), `parent.postMessage({ kiwiProbe: { notes: "${version}" } }, "*")\n`);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: NOTES, env: GIT_ENV, stdio: "ignore" });
  if (!existsSync(join(NOTES, ".git"))) git("init", "--quiet", "--initial-branch", "main");
  git("add", "-A");
  git("commit", "--quiet", "-m", version);
}

const inRow = ({ mod, control }: { mod: string; control: string }): boolean => {
  const row = [...document.querySelectorAll<HTMLElement>(".set-row")].find((r) => (r.querySelector(".set-row-label")?.textContent ?? "").startsWith(`${mod} `));
  const el = row && [...row.querySelectorAll<HTMLElement>("button")].find((b) => (b.textContent ?? "").trim() === control || b.getAttribute("aria-label") === control);
  if (!el || (el as HTMLButtonElement).disabled) return false;
  el.click();
  return true;
};

const catalogInstall = (name: string): boolean => {
  const row = [...document.querySelectorAll<HTMLElement>(".mod-catalog-row")].find((r) => r.querySelector(".set-row-label")?.textContent === name);
  const el = row && [...row.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === "Install");
  if (!el || el.disabled) return false;
  el.click();
  return true;
};

async function fromKiwi(d: Driver): Promise<void> {
  const installed = (name: string) =>
    d.evaluate((n) => [...document.querySelectorAll(".mod-catalog-row")].some((r) => r.querySelector(".set-row-label")?.textContent === n && (r.textContent ?? "").includes("Installed")), name, 2_000);
  await step("Settings → About", 10_000, () => d.evaluate(clickText, { selector: ".set-nav .side-row", text: "About" }, 2_000));
  await step("Settings → Mods", 10_000, () => d.evaluate(clickText, { selector: ".set-nav .side-row", text: "Mods" }, 2_000));
  await step("From Kiwi lists the catalog's mods", 15_000, () =>
    d.evaluate(() => [...document.querySelectorAll(".mod-catalog-row .set-row-label")].map((l) => l.textContent).join(" ") === "catalog-mod tampered-mod", null, 2_000),
  ).catch(async (e: unknown) => {
    const asked = await d.evaluate(() => (window as unknown as { kiwi: { modCatalog(): Promise<unknown> } }).kiwi.modCatalog(), null, 40_000).catch((x: unknown) => String(x));
    console.log(`the catalog, asked: ${JSON.stringify(asked)}`);
    console.log(`the page then: ${JSON.stringify(await d.evaluate(pageNow, null, 3_000).catch((x: unknown) => String(x)), null, 1)}`);
    throw e;
  });
  await shot("settings-mods-from-kiwi");
  await step("catalog-mod's row opens its page", 10_000, () =>
    d.evaluate(
      () => {
        const row = [...document.querySelectorAll<HTMLElement>(".mod-catalog-row")].find((r) => r.querySelector(".set-row-label")?.textContent === "catalog-mod");
        const open = row?.querySelector<HTMLButtonElement>(".mod-open");
        open?.click();
        return !!open;
      },
      null,
      2_000,
    ),
  );
  const store = await until("its store page", 20_000, () =>
    d.evaluate(
      () => {
        const readme = document.querySelector(".mod-readme")?.textContent ?? "";
        const shots = [...document.querySelectorAll<HTMLImageElement>("img.mod-shot")];
        if (!readme.includes("reads its README") || !shots.length || !shots.every((i) => i.complete)) return null;
        return {
          title: document.querySelector(".mod-head .set-title")?.textContent,
          meta: document.querySelector(".mod-head-text .set-lede")?.textContent,
          shots: shots.map((i) => ({ alt: i.alt, w: i.naturalWidth })),
          skipped: document.querySelector('.set-group[aria-label="Screenshots"] .set-group-hint')?.textContent,
          install: [...document.querySelectorAll(".mod-head-act button")].some((b) => b.textContent === "Install"),
        };
      },
      null,
      2_000,
    ),
  ).catch(() => null);
  console.log(`catalog-mod's page: ${JSON.stringify(store)}`);
  await shot("mod-store-page");
  check(store?.title === "catalog-mod" && store.meta === "1.0.0" && store.install, "a From Kiwi row opens its page with its version and Install");
  check(store?.shots.length === 1 && store.shots[0]!.w === 1, "its page shows the screenshot from its media folder");
  check(store?.skipped === "2-liar.png: it isn't the PNG its name says", "a screenshot that isn't a picture is left out, and its page says why");
  await step("back to Mods", 10_000, () => d.evaluate(clickText, { selector: ".mod-head-back", text: "Mods" }, 2_000));
  await step("catalog-mod's Install", 10_000, () => d.evaluate(catalogInstall, "catalog-mod", 2_000));
  await step("its ask says what it asks for", 10_000, () =>
    d.evaluate(() => (document.querySelector('dialog[open][aria-label="Install catalog-mod"] .mod-needs')?.textContent ?? "").length > 0, null, 2_000),
  );
  await later(300);
  await shot("mod-install-ask");
  await step("Allow, in its ask", 10_000, () => d.evaluate(clickText, { selector: 'dialog[open][aria-label="Install catalog-mod"] .modal-foot button', text: "Allow" }, 2_000));
  const on = await until("catalog-mod on", 30_000, async () => ((await modsNow(d)).find((m) => m.name === "catalog-mod")?.state === "on" ? true : null)).catch(() => null);
  check(!!on, "one Install and one Allow put a catalog mod in and turn it on, without a restart");
  const sources = JSON.parse(readFileSync(join(root, ".kiwi", "mods", ".sources.json"), "utf8")) as Record<string, { commit?: string }>;
  check(sources["catalog-mod"]?.commit === CATALOG_COMMIT, "it is kept at the commit the catalog pins");
  check((await until("catalog-mod Installed", 10_000, async () => ((await installed("catalog-mod")) ? true : null)).catch(() => false)) === true, "its row in From Kiwi says Installed");
  await step("tampered-mod's Install", 10_000, () => d.evaluate(catalogInstall, "tampered-mod", 2_000));
  await step("Allow, in tampered-mod's ask", 10_000, () => d.evaluate(clickText, { selector: 'dialog[open][aria-label="Install tampered-mod"] .modal-foot button', text: "Allow" }, 2_000));
  const why = await until("the refusal", 15_000, () =>
    d.evaluate(() => [...document.querySelectorAll(".toasts .toast")].map((t) => t.textContent ?? "").find((t) => t.includes("the copy the catalog vouches for")) ?? null, null, 2_000),
  ).catch(() => null);
  console.log(`tampered-mod: ${JSON.stringify(why)}`);
  await shot("mod-install-refused");
  check(!!why, "a download that isn't the vouched copy is refused, and the person sees why");
  check(!existsSync(join(root, ".kiwi", "mods", "tampered-mod")) && !(await modsNow(d)).some((m) => m.name === "tampered-mod"), "nothing of the tampered mod is left on disk or in the list");
  check(!(await heard(d)).some((m) => m["tamperedRan"]), "the tampered code never ran");
}

async function clipboardNow(d: Driver): Promise<string> {
  if (process.platform === "darwin") return spawnSync("pbpaste", [], { encoding: "utf8" }).stdout ?? "";
  const x = spawnSync("xclip", ["-o", "-selection", "clipboard"], { encoding: "utf8", timeout: 5_000 });
  if (x.status === 0) return x.stdout ?? "";
  return d.evaluate(() => navigator.clipboard.readText(), null, 5_000).catch((e: unknown) => `unreadable: ${String(e)}`);
}

async function newMod(d: Driver, palette: () => Promise<boolean>): Promise<void> {
  const dialog = 'dialog[open][aria-label="New mod"]';
  const words = "A panel that counts my open tasks";
  await step("the Mods page", 10_000, () =>
    d.evaluate(
      () => (document.querySelector('.rail-mods[aria-current="page"]') && document.querySelector(".set-head-act") ? true : (document.querySelector<HTMLElement>(".rail-mods")?.click(), false)),
      null,
      2_000,
    ),
  );
  await step("New mod, on the Mods page", 10_000, () => d.evaluate(clickText, { selector: ".set-head-act button", text: "New mod" }, 2_000));
  await step("what it should do", 10_000, () => d.evaluate(fillIn, { selector: `${dialog} textarea`, value: words }, 2_000));
  await later(300);
  await shot("new-mod");
  await step("Copy prompt", 10_000, () => d.evaluate(clickText, { selector: `${dialog} .modal-foot button`, text: "Copy prompt" }, 2_000));
  const said = await until("its toast", 10_000, () =>
    d.evaluate(() => [...document.querySelectorAll(".toasts .toast")].map((t) => t.textContent ?? "").find((t) => t.includes("Prompt copied") || t.includes("Couldn't copy")) ?? null, null, 2_000),
  ).catch(() => null);
  const copied = await until("the prompt on the clipboard", 10_000, async () => ((await clipboardNow(d)).includes(words) ? true : null)).catch(() => null);
  const held = await clipboardNow(d);
  console.log(`New mod: ${JSON.stringify(said)}, the clipboard holds ${held.length} characters, starting ${JSON.stringify(held.slice(0, 80))}`);
  check(said === "Prompt copied. Paste it into any agent.", "Copy prompt says it copied, and where it goes");
  check(!!copied && held.includes("# Making a Channels mod") && held.includes("kiwi mod check") && !held.startsWith("---"), "the clipboard holds the mods skill, without its front matter");
  check(held.includes(`Make me a Channels mod with the guide above: ${words}`), "and the person's words, after the skill");
  check(!(await d.evaluate((sel) => !!document.querySelector(sel), dialog, 2_000)), "and the dialog closes");
  await shot("new-mod-copied");
  await until("New mod, from ⌘K", 20_000, async () => {
    if (await d.evaluate((sel) => !!document.querySelector(sel), dialog, 2_000)) return true;
    await palette();
    await d.evaluate(fillIn, { selector: ".palette-input", value: "New mod" }, 2_000).catch(() => false);
    await d.evaluate(clickText, { selector: ".palette-item", text: "New mod" }, 2_000).catch(() => false);
    return null;
  });
  check(await d.evaluate((sel) => !!document.querySelector(`${sel} textarea`) && !document.querySelector(`${sel} .modal-tabs`), dialog, 2_000), "⌘K opens the same one field, with no tabs");
  await step("Cancel", 10_000, () => d.evaluate(clickText, { selector: `${dialog} .modal-foot button`, text: "Cancel" }, 2_000));
}

const confirmIt = (action: string): boolean => {
  const b = [...document.querySelectorAll<HTMLButtonElement>("dialog[open] .modal-foot button")].find((x) => (x.textContent ?? "").trim() === action);
  b?.click();
  return !!b;
};

async function openFromPage(d: Driver): Promise<void> {
  await step("back to the channel", 10_000, () => d.evaluate(() => (document.querySelector<HTMLElement>(".set-back")?.click(), !document.querySelector(".set-nav")), null, 2_000));
  await step("no panel beside the chat", 10_000, () =>
    d.evaluate(
      () => {
        const close = document.querySelector<HTMLElement>('.panel button[aria-label="Close"]');
        close?.click();
        return !close && !document.querySelector(".panel .mod-slot");
      },
      null,
      2_000,
    ),
  );
  await settingsMods(d, "probe-mod");
  await step("probe-mod's page", 10_000, () => d.evaluate(clickText, { selector: ".set-main .mod-open", text: "probe-mod" }, 2_000));
  await step("its Open", 10_000, () => d.evaluate(clickText, { selector: ".set-main .mod-head-act button", text: "Open" }, 2_000));
  const opened = await until("probe-mod's panel, from its page", 15_000, async () => {
    const t = await d.evaluate(topAt, ".panel .mod-slot", 2_000);
    return t.top === "frame probe-mod" ? t : null;
  }).catch(() => null);
  const left = await d.evaluate(() => !document.querySelector(".set-nav"), null, 2_000);
  console.log(`after Open: ${JSON.stringify({ opened, left })}`);
  check(!!opened && left, "Open on a mod's page in Settings → Mods leaves settings and shows its panel beside the chat");
  await shot("mod-open-from-settings");
  await settingsMods(d, "probe-mod");
}

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

async function floodSizes(d: Driver): Promise<void> {
  const before = await d.evaluate(() => document.querySelector<HTMLElement>(".side .mod-side-slot")?.getBoundingClientRect().height ?? null, null, 2_000);
  const started = await d.evaluate(
    (settle) => {
      const slot = document.querySelector<HTMLElement>(".side .mod-side-slot");
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="probe-mod in the sidebar"]');
      if (!slot || !frame?.contentWindow || settle === null) return false;
      const flood = { applied: 0, frames: 0, live: true, seen: null as MutationObserver | null };
      const tick = (): void => {
        if (!flood.live) return;
        flood.frames++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      flood.seen = new MutationObserver((records) => void (flood.applied += records.length));
      flood.seen.observe(slot, { attributes: true, attributeFilter: ["style"] });
      (window as unknown as { __sizeFlood?: typeof flood }).__sizeFlood = flood;
      frame.contentWindow.postMessage({ floodSizes: settle }, "*");
      return true;
    },
    before,
    2_000,
  );
  check(started, "the probe's sidebar section is there to flood");
  if (!started) return;
  let slowest = 0;
  for (const end = Date.now() + 2_500; Date.now() < end;) {
    const asked = Date.now();
    await d.evaluate(() => true, null, 10_000).catch(() => false);
    slowest = Math.max(slowest, Date.now() - asked);
    await later(100);
  }
  const flooded = await until("the flood's end", 10_000, async () => ((await heard(d)).find((m) => "flooded" in m)?.["flooded"] as number | undefined) ?? null).catch(() => null);
  await later(500);
  const heights: number[] = [];
  for (let i = 0; i < 3; i++) {
    heights.push(await d.evaluate(() => document.querySelector<HTMLElement>(".side .mod-side-slot")?.getBoundingClientRect().height ?? -1, null, 2_000));
    await later(300);
  }
  const counted = await d.evaluate(
    () => {
      const flood = (window as unknown as { __sizeFlood?: { applied: number; frames: number; live: boolean; seen: MutationObserver | null } }).__sizeFlood;
      if (!flood) return null;
      flood.live = false;
      flood.seen?.disconnect();
      return { applied: flood.applied, frames: flood.frames };
    },
    null,
    2_000,
  );
  console.log(
    `a sidebar frame posted ${flooded} sizes in 2 s: the page answered in ${slowest} ms at worst; ${counted?.applied} sizes applied over ${counted?.frames} frames; then ${JSON.stringify(heights)} (before: ${before})`,
  );
  check((flooded ?? 0) > 1_000, "the probe's sidebar frame floods the host with sizes");
  check(slowest < 1_000, "the page answers within 1 s while a sidebar frame floods sizes");
  check(!!counted && counted.applied <= counted.frames + 1, "the host applies at most one size per animation frame");
  check(
    heights.every((h) => h === before),
    "the section settles at one height, the one it had",
  );
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
  screenshot(shots, name);
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const s = lstatSync(p);
    return s.isDirectory() ? files(p) : s.isFile() ? [p] : [];
  });
}

const holding = (secret: string): string[] => files(root).filter((f) => readFileSync(f).includes(secret));
const TEST_STORE = "kiwi-eb-test-store.json";
const outsideStore = (secret: string): string[] => holding(secret).filter((f) => basename(f) !== TEST_STORE);

async function kitMod(d: Driver, palette: () => Promise<boolean>): Promise<void> {
  writeKitMod(1);
  const kit = async () => (await heard(d)).filter((m) => m["kit"] === true);
  const asking = () => d.evaluate(() => (document.querySelector('dialog[open][aria-label="kit-mod asks to run"]') ? true : null), null, 2_000).catch(() => null);
  await until("kit-mod's ask, by itself or from ⌘K", 30_000, async () => {
    if (await asking()) return true;
    await palette();
    await d.evaluate(fillIn, { selector: ".palette-input", value: "kit-mod" }, 2_000).catch(() => false);
    await d.evaluate(clickText, { selector: ".palette-item", text: "Set up kit-mod" }, 2_000).catch(() => false);
    return asking();
  });
  await step("Allow the kit mod", 10_000, () => d.evaluate(clickText, { selector: 'dialog[open][aria-label="kit-mod asks to run"] .modal-foot button', text: "Allow" }, 2_000));
  const first = await until("the kit mod's first visit", 30_000, async () => (await kit()).find((m) => "visits" in m || "storageFailed" in m) ?? null).catch(() => null);
  console.log(`the kit mod: ${JSON.stringify(first)}`);
  check(first?.["visits"] === 1, "a mod built only from the kit runs and keeps a value in its own storage");
  await step("the kit mod's panel title", 10_000, () => d.evaluate(clickText, { selector: ".panel .panel-title", text: "Kit mod" }, 2_000));
  const was = await d.evaluate(() => document.documentElement.dataset["theme"] ?? null, null, 2_000);
  for (const theme of ["light", "dark"]) {
    await d.evaluate((t) => void (document.documentElement.dataset["theme"] = t), theme, 2_000);
    await later(1_000);
    await shot(`kit-mod-${theme}`);
  }
  await d.evaluate(
    (t) => {
      if (t === null) delete document.documentElement.dataset["theme"];
      else document.documentElement.dataset["theme"] = t;
      return true;
    },
    was,
    2_000,
  );
  const ask = async (test: string, extra: Record<string, unknown> = {}): Promise<Said | null> => {
    const before = (await kit()).filter((m) => m["test"] === test).length;
    await d.evaluate(
      (m) => {
        const f = document.querySelector<HTMLIFrameElement>('iframe[title="kit-mod"]');
        f?.contentWindow?.postMessage(m, "*");
        return !!f;
      },
      { kitTest: test, ...extra },
      2_000,
    );
    return until(`the kit mod's ${test}`, 10_000, async () => (await kit()).filter((m) => m["test"] === test)[before] ?? null).catch(() => null);
  };
  const all = (await ask("clear"))?.["rows"];
  const searched = (await ask("search", { q: "beta" }))?.["rows"];
  console.log(`the kit mod's list: ${JSON.stringify(all)}, and for "beta": ${JSON.stringify(searched)}`);
  check(
    JSON.stringify(all) === JSON.stringify(["Alpha release", "Beta notes", "Gamma plan"]) && JSON.stringify(searched) === JSON.stringify(["Beta notes"]),
    "the kit's list shows its sections' items, and its search keeps only what matches",
  );
  await ask("enter");
  const toast = await until("the kit mod's toast", 10_000, () =>
    d.evaluate(() => [...document.querySelectorAll(".toasts .toast")].map((t) => t.textContent ?? "").find((t) => t.includes("kit-mod: Picked Beta")) ?? null, null, 2_000),
  ).catch(() => null);
  check(!!toast, "↵ runs the item's first action, and the mod's toast shows in the app with the mod's name");
  check(JSON.stringify((await ask("clear"))?.["rows"]) === JSON.stringify(all), "Escape clears the kit list's search");
  writeKitMod(2);
  const again = await until("the kit mod's second visit", 30_000, async () => (await kit()).find((m) => m["version"] === 2) ?? null).catch(() => null);
  console.log(`the kit mod, reloaded: ${JSON.stringify(again)}`);
  check(again?.["visits"] === 2, "a kit mod's storage outlives a reload");
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
writeTerminalMod();
writeSettingsMod();
mkdirSync(join(root, "home"), { recursive: true });
writeFileSync(TMUX_CONF, TMUX_BEFORE);
let app = launch(exe, testEnv(root, join(root, "driver.sock"), RELAY, TERMINAL_ENV));
try {
  const d = await attach(join(root, "driver.sock"));
  await firstChannel(d, 0, { shots, home: join(root, "home") });
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
  const askOf = () => d.evaluate(() => document.querySelector('dialog[open][aria-label$=" asks to run"]')?.getAttribute("aria-label") ?? null, null, 2_000);
  const firstAsk = await until("a mod's ask, by itself", 15_000, askOf).catch(() => null);
  check(firstAsk === "probe-mod asks to run", "a new mod's ask comes to the person by itself, without ⌘K");
  await step("Not now", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Not now" }, 2_000));
  const nextAsk = await until("the next mod's ask", 15_000, async () => {
    const a = await askOf();
    return a && a !== firstAsk ? a : null;
  }).catch(() => null);
  check(nextAsk === "terminal-mod asks to run", "Not now puts it off, and the next mod's ask follows");
  check(await d.evaluate(() => !!document.querySelector(".rail-mods .rail-mods-dot"), null, 2_000), "a mod put off leaves a dot on the rail's mods icon");
  await step("the terminal mod's snippets, in its ask", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .mod-snippet pre", text: "source-file -q" }, 2_000));
  for (const theme of ["dark", "light"]) {
    await d.evaluate(
      (t) => {
        document.documentElement.dataset["theme"] = t;
        return true;
      },
      theme,
      2_000,
    );
    await later(300);
    await shot(`mod-asks-terminal-${theme}`);
  }
  await d.evaluate(
    () => {
      delete document.documentElement.dataset["theme"];
      return true;
    },
    null,
    2_000,
  );
  check(readFileSync(TMUX_CONF, "utf8") === TMUX_BEFORE && !existsSync(REX_INIT), "a terminal mod changes no config while it waits for the person");
  await step("Allow the terminal mod", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Allow" }, 2_000));
  const heardTerminals = await until("the terminal mod's list", 30_000, async () => (await heard(d)).find((m) => "terminals" in m) ?? null).catch(() => null);
  console.log(`the terminal mod heard: ${JSON.stringify(heardTerminals)}`);
  check(Array.isArray(heardTerminals?.["terminals"]), "an approved terminal mod lists this computer's agents' terminals");
  const conf = readFileSync(TMUX_CONF, "utf8");
  check(
    conf.startsWith(`${TMUX_BEFORE}\n`) && /^source-file -q ".*terminal-mod\/tmux\.conf" # Kiwi mod terminal-mod$/m.test(conf.slice(TMUX_BEFORE.length)),
    "turning it on adds one line to ~/.tmux.conf, after the person's own",
  );
  check(existsSync(REX_INIT) && readFileSync(REX_INIT, "utf8").endsWith("-- Kiwi mod terminal-mod\n"), "and one line to Rex's init.lua");
  rmSync(terminalFolder, { recursive: true, force: true });
  const gone = await until("terminal-mod removed", 30_000, async () => ((await modsNow(d)).some((m) => m.name === "terminal-mod") ? null : true)).catch(() => null);
  check(!!gone && readFileSync(TMUX_CONF, "utf8") === TMUX_BEFORE, "removing the mod puts ~/.tmux.conf back byte for byte");
  check(!existsSync(REX_INIT), "and removes the Rex init.lua it made");
  const railMods = (on: boolean) => d.evaluate((want) => !!document.querySelector(`.rail-mods${want ? '[aria-current="page"]' : ":not([aria-current])"}`), on, 2_000);
  await step("the rail's mods icon", 10_000, () => railMods(false));
  await d.evaluate(() => (document.querySelector<HTMLElement>(".rail-mods")?.click(), true), null, 2_000);
  await step("the Mods page, from the rail", 10_000, () => railMods(true));
  await step("probe-mod waits at the top of the Mods page", 10_000, () =>
    d.evaluate(() => (document.querySelector(".set-main .set-group")?.textContent ?? "").includes("probe-mod asks to run"), null, 2_000),
  );
  await later(300);
  await shot("settings-mods-waiting");
  await d.evaluate(() => (document.querySelector<HTMLElement>(".rail-mods")?.click(), true), null, 2_000);
  await step("the rail's mods icon takes it back to the channel", 10_000, () => railMods(false));
  await step("⌘K", 10_000, palette);
  await step("Set up probe-mod in ⌘K", 10_000, () => d.evaluate(clickText, { selector: ".palette-item", text: "Set up probe-mod" }, 2_000));
  await step("what the mod asks for, in its ask", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .mod-needs li", text: "Talk to example.com" }, 2_000)).catch(async (e: unknown) => {
    console.log(`the page then: ${JSON.stringify(await d.evaluate(pageNow, null, 3_000).catch((x: unknown) => String(x)), null, 1)}`);
    throw e;
  });
  await shot("mod-asks");
  const bridgeAt = (await bridgeEvents(d)).length;
  await step("Allow", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Allow" }, 2_000));
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
  check(!(await d.evaluate(() => !!document.querySelector(".rail-mods-dot"), null, 2_000)), "Allow turns it on, and the rail's dot goes");
  await step("the mod's panel title, opened by Allow", 10_000, () => d.evaluate(clickText, { selector: ".panel .panel-title", text: "Probe mod" }, 2_000));
  await shot("mod-panel");
  const sideAsked = Date.now();
  const sideTops = new Set<string>();
  const sideTop = await until("the mod's sidebar section", 15_000, async () => {
    const t = await d.evaluate(topAt, ".side .mod-side-slot", 2_000);
    sideTops.add(JSON.stringify(t));
    return t.found && t.top === "frame probe-mod in the sidebar" ? t : null;
  }).catch(() => null);
  console.log(`at the sidebar section after ${Date.now() - sideAsked} ms: ${JSON.stringify(sideTop)}; seen there: ${[...sideTops].join(", ")}`);
  check(sideTop?.top === "frame probe-mod in the sidebar", "a mod that asked for a sidebar section shows it, drawn by its own frame");
  const titles = await d.evaluate(() => [...document.querySelectorAll(".side .mod-side h3")].map((h) => h.textContent), null, 2_000);
  check(titles.includes("Probe side") && !titles.includes("Quiet side"), "a mod that didn't ask for a sidebar section gets none, even when it posts one");
  await floodSizes(d);
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
  const whileMod = (await bridgeEvents(d)).slice(bridgeAt);
  console.log(`events the app heard from its web view while the mod forged its own: ${JSON.stringify(whileMod)}`);
  check(
    !whileMod.some((e) => e.detail.includes("forged") || e.detail.includes(ASK_AGAIN_URL)),
    "none of the mod's forged new-window-open, will-navigate, dom-ready or host-message events reached the app",
  );
  check(!whileMod.some((e) => e.name !== "will-navigate"), "no dom-ready, host-message or new-window-open reached the app while the mod ran");
  const all = await bridgeEvents(d);
  console.log(`everything the app heard from its web view since it started: ${JSON.stringify(all.slice(0, bridgeAt))}`);
  const pageAt = all.length;
  const page = await postFromPage(d);
  const fromPage = await until("the page's own events", 10_000, async () => {
    const got = (await bridgeEvents(d)).slice(pageAt);
    return PAGE_EVENTS.every((n) => got.some((e) => e.name === n && e.detail.includes(`page-${n}`))) ? got : null;
  }).catch(async () => (await bridgeEvents(d)).slice(pageAt));
  console.log(`the page posted its own ${PAGE_EVENTS.join(" and ")}: ${JSON.stringify(page)}; the app heard: ${JSON.stringify(fromPage)}`);
  check(
    page.posted && PAGE_EVENTS.every((n) => fromPage.some((e) => e.name === n && e.detail.includes(`page-${n}`))),
    "the top page's own dom-ready and host-message, posted the same way, reach the app",
  );
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
  const waiting = (await modsNow(d)).find((m) => m.name === "settings-mod");
  console.log(`settings-mod before its secret: ${JSON.stringify(waiting)}`);
  check(waiting?.state === "off" && waiting.off === "settings" && (waiting.why ?? "").includes("Token"), "a mod whose required setting is empty stays off and says which one");
  const atRest = (await d.evaluate(() => (window as unknown as { kiwi: { keysAtRest(): Promise<unknown> } }).kiwi.keysAtRest(), null, 10_000)) as { sealed: boolean; why: string | null };
  check(atRest.sealed, `the app's store is sealed, so a secret can be kept${atRest.why ? `: ${atRest.why}` : ""}`);
  await d.evaluate((v) => (window as unknown as { kiwi: { setModSetting(n: string, i: string, v: string): Promise<unknown> } }).kiwi.setModSetting("settings-mod", "token", v), SECRET, 10_000);
  const given = await until("settings-mod's settings", 30_000, async () => (await heard(d)).find((m) => m["settingsMod"]) ?? null).catch(() => null);
  check((given?.["settingsMod"] as Record<string, unknown> | undefined)?.["token"] === SECRET, "once its secret is saved the mod starts, and settings() hands it the secret");
  check(!(await heard(d)).some((m) => !m["settingsMod"] && JSON.stringify(m).includes(SECRET)), "no other mod's frame gets it");
  check(
    (await heard(d)).filter((m) => m["version"] !== undefined).every((m) => JSON.stringify(m["settings"]) === "{}"),
    "a mod with no settings gets an empty settings()",
  );
  check(
    holding(SECRET).some((f) => basename(f) === TEST_STORE),
    `the secret is kept in the app's store, which the test build keeps as ${TEST_STORE} and a release seals`,
  );
  const leaked = outsideStore(SECRET);
  check(!leaked.length, `the secret is in no other file, under ~/.kiwi or anywhere else${leaked.length ? `: ${leaked.join(", ")}` : ""}`);
  await later(1_500);
  const opens = (await d.main("browserOpens")) as string[];
  console.log(`opened in the browser: ${JSON.stringify(opens)}`);
  check(opens.includes("https://example.com/?page-link"), "with a mod running, the page's own links still open in the browser");
  check(opens.includes(MESSAGE_LINK), "with a mod running, a Ctrl-clicked link in a message still opens in the browser");
  check(!opens.some((u) => /forged|mod-self-nav/.test(u)), "nothing the mod forged or navigated to opened in the browser");
  check(app.exitCode === null && app.signalCode === null, "the app is still running after the mod's forged events");
  await kitMod(d, palette);
  if (process.platform === "darwin" || desk) await whileAway(d, palette);
  writeCrashMod();
  const crashed = await until("crash-mod switched off", 30_000, async () => (await modsNow(d)).find((m) => m.name === "crash-mod" && m.state === "off") ?? null).catch(() => null);
  console.log(`crash-mod: ${JSON.stringify(crashed)}`);
  check(crashed?.off === "crash" && (crashed.why ?? "").includes(CRASH), "a mod that throws as it starts is switched off, with its error as the reason");
  check((await modsNow(d)).find((m) => m.name === "probe-mod")?.state === "on", "the other mods keep running");
  await settingsMods(d, CRASH);
  await d.main("activate").catch(() => null);
  await later(1_000);
  await shot("settings-mods");
  const icon = await until("probe-mod's icon in Settings → Mods", 15_000, () =>
    d
      .evaluate(
        () => {
          const img = document.querySelector<HTMLImageElement>(".set-main img.mod-icon");
          if (!img?.complete || img.naturalWidth === 0) return null;
          return {
            blob: img.src.startsWith("blob:"),
            inline: document.querySelectorAll(".set-main svg script, .set-main svg[onload]").length,
            ran: (window as unknown as { __iconRan?: unknown }).__iconRan ?? null,
          };
        },
        null,
        2_000,
      )
      .catch(() => null),
  ).catch(() => null);
  console.log(`probe-mod's icon: ${JSON.stringify(icon)}`);
  check(!!icon?.blob && icon.inline === 0 && icon.ran === null && !(await heard(d)).some((m) => m["iconRan"]), "a mod's SVG icon shows as an image from a blob, and its script and onload never run");
  await step("probe-mod's details", 10_000, () => d.evaluate(clickText, { selector: ".set-main .mod-open", text: "probe-mod" }, 2_000));
  await step("its details page says what it may do", 10_000, () => d.evaluate(() => (document.querySelector(".set-main")?.textContent ?? "").includes("What it may do"), null, 2_000));
  await later(500);
  await shot("settings-mod-details");
  await openFromPage(d);
  notesVersion("1.0.0", []);
  addMod(join(root, ".kiwi"), NOTES);
  const notes = async () => (await modsNow(d)).find((m) => m.name === "notes-mod") ?? null;
  const added = await until("notes-mod, added from its repo", 30_000, async () => ((await notes())?.state === "on" ? true : null)).catch(() => null);
  check(!!added, "a mod added from a git repo runs without a restart");
  notesVersion("1.1.0", ["net:example.com"]);
  await step("Settings → About", 10_000, () => d.evaluate(clickText, { selector: ".set-nav .side-row", text: "About" }, 2_000));
  await settingsMods(d, "notes-mod");
  await step("notes-mod's Update, once its repo has a new commit", 60_000, () => d.evaluate(inRow, { mod: "notes-mod", control: "Update to 1.1.0" }, 2_000));
  await step("the update's confirm, which says what it now asks for", 10_000, () =>
    d.evaluate(() => (document.querySelector("dialog[open]")?.textContent ?? "").includes("Talk to example.com"), null, 2_000),
  );
  await shot("settings-mods-update");
  await step("Update in the confirm", 10_000, () => d.evaluate(confirmIt, "Update", 2_000));
  const updated = await until("notes-mod 1.1.0", 30_000, async () => {
    const m = await notes();
    return m?.version === "1.1.0" ? m : null;
  }).catch(() => null);
  check(updated?.state === "asks", "Update takes the new version from the page, and a mod that asks for more waits for the person");
  const askedMore = await until("notes-mod's ask, by itself, after the update", 15_000, () =>
    d.evaluate(() => ((document.querySelector('dialog[open][aria-label="notes-mod asks to run"]')?.textContent ?? "").includes("Talk to example.com") ? true : null), null, 2_000),
  ).catch(() => null);
  check(!!askedMore, "after an update that asks for more, its ask comes by itself and names it");
  await later(300);
  await shot("mod-asks-more");
  await step("Allow, in its ask", 10_000, () => d.evaluate(clickText, { selector: "dialog[open] .modal-foot button", text: "Allow" }, 2_000));
  const allowed = await until("notes-mod on", 15_000, async () => ((await notes())?.state === "on" ? true : null)).catch(() => null);
  check(!!allowed, "Allow turns it on with what it now asks for");
  await step("notes-mod's switch, off", 10_000, () => d.evaluate(inRow, { mod: "notes-mod", control: "Run notes-mod" }, 2_000));
  const off = await until("notes-mod off", 15_000, async () => ((await notes())?.off === "you" ? true : null)).catch(() => null);
  check(!!off, "its switch turns it off again");
  await step("notes-mod's details", 10_000, () => d.evaluate(clickText, { selector: ".set-main .mod-open", text: "notes-mod" }, 2_000));
  await step("Remove, at the foot of its details", 10_000, () => d.evaluate(inRow, { mod: "Remove", control: "Remove" }, 2_000));
  await later(300);
  await shot("settings-mods-remove");
  await step("Remove in the confirm", 10_000, () => d.evaluate(confirmIt, "Remove", 2_000));
  const removed = await until("notes-mod gone", 30_000, async () => ((await notes()) === null ? true : null)).catch(() => null);
  check(!!removed && !existsSync(join(root, ".kiwi", "mods", "notes-mod")), "Remove takes it out of the list and off the disk, without a restart");
  const back = await until("the Mods list again", 10_000, () =>
    d.evaluate(
      () => (document.querySelector(".set-main .mod-open") && ![...document.querySelectorAll(".set-row-label")].some((l) => (l.textContent ?? "").startsWith("notes-mod ")) ? true : null),
      null,
      2_000,
    ),
  ).catch(() => null);
  check(!!back, "the page goes back to the Mods list, without its row");
  await fromKiwi(d);
  await posts(d);
  await reads(d);
  await newMod(d, palette);
  d.close();
  await stop(app);
  writeFileSync(join(root, ".kiwi", "mods", ".safe-mode"), "");
  app = launch(exe, testEnv(root, join(root, "safe.sock"), RELAY, TERMINAL_ENV));
  const safe = await attach(join(root, "safe.sock"));
  await step("the channel, in safe mode", 60_000, () => safe.evaluate(() => !!document.querySelector(".chan"), null, 2_000));
  const listed = await modsNow(safe);
  console.log(`mods in safe mode: ${JSON.stringify(listed)}`);
  check(listed.every((m) => m.state !== "on") && listed.find((m) => m.name === "probe-mod")?.off === "safe", "safe mode starts with every mod off, and says why");
  check(!existsSync(join(root, ".kiwi", "mods", ".safe-mode")), "safe mode by .safe-mode lasts one start: the app removes the file");
  const afterRestart = (await safe.evaluate(() => (window as unknown as { kiwi: { modDetails(n: string): Promise<unknown> } }).kiwi.modDetails("settings-mod"), null, 10_000)) as {
    settings?: { id: string; set?: boolean; value?: unknown }[];
  } | null;
  check(
    afterRestart?.settings?.find((x) => x.id === "token")?.set === true && !JSON.stringify(afterRestart).includes(SECRET),
    "the saved secret outlasts a restart, and the details page never gets it back",
  );
  const after = outsideStore(SECRET);
  check(!after.length, `after a restart, the secret is still in no other file${after.length ? `: ${after.join(", ")}` : ""}`);
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
  await daemonStop(join(botHome, "home"), 2_000).catch(() => false);
  relay.kill();
  void catalogServer.stop(true);
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
