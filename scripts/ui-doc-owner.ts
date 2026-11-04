#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserContext, type Page, type WebSocketRoute } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { firstRun, letIn, newChannel } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = harnessDist(arg("dist"));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const SEND = arg("send-key") ?? "ControlOrMeta+Enter";
const ONLY = arg("only");
const KEY_MS = 90;
const SETTLE_MS = 2500;

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-owner-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ").slice(0, 60)} exited ${code}: ${out.trim().split("\n").pop()}`)))));
};
const bot = (...args: string[]): Promise<string> => kiwi(["-c", "owner", "--as", "bot", ...args]);

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];

interface Person {
  label: string;
  name: string;
  page: Page;
  slow: { ms: number; sockets: WebSocketRoute[] };
}

function inOrder(slow: { ms: number }): (send: () => void) => void {
  const queue: { at: number; send: () => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pump = (): void => {
    timer = null;
    while (queue.length && queue[0]!.at <= Date.now()) queue.shift()!.send();
    if (queue.length) timer = setTimeout(pump, Math.max(0, queue[0]!.at - Date.now()));
  };
  return (send) => {
    if (!slow.ms && !queue.length) return send();
    queue.push({ at: Math.max(queue.at(-1)?.at ?? 0, Date.now() + slow.ms), send });
    timer ??= setTimeout(pump, Math.max(0, queue[0]!.at - Date.now()));
  };
}

async function person(name: string, base: string, from?: Person): Promise<Person> {
  const storageState = from ? await from.page.context().storageState({ indexedDB: true }) : undefined;
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState });
  const slow = { ms: 0, sockets: [] as WebSocketRoute[] };
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    slow.sockets.push(ws);
    const up = inOrder(slow);
    const down = inOrder(slow);
    ws.onMessage((m) => up(() => server.send(m)));
    server.onMessage((m) => down(() => ws.send(m)));
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  if (!from) await firstRun(page, name);
  return { name, label: from ? `${name}'s other window` : name, page, slow };
}

async function joinAs(p: Person, base: string, code: string, owner: Page): Promise<void> {
  await p.page.goto(`${base}#${code}`);
  await p.page.getByRole("button", { name: "Ask to join" }).click({ timeout: 20000 });
  let inside = false;
  const waiting = p.page
    .locator(".thread-doc")
    .first()
    .waitFor({ timeout: 120000 })
    .then(() => void (inside = true));
  await letIn(owner, () => !inside);
  await waiting;
}

async function general(p: Person): Promise<void> {
  await p.page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /general/ })
    .click();
  await p.page.locator(".thread-doc .ProseMirror").first().waitFor({ timeout: 30000 });
}

async function startLine(p: Person): Promise<void> {
  await p.page.locator(".thread-doc .doc-tail").last().click();
}

interface Here {
  id: string;
  author: string;
  text: string;
}

async function here(p: Person): Promise<Here | null> {
  return p.page.evaluate(() => {
    const at = getSelection()?.anchorNode ?? null;
    const el = at instanceof Element ? at : (at?.parentElement ?? null);
    const section = el?.closest<HTMLElement>(".thread-doc section.blk");
    const node = (section as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } } | null)?.pmViewDesc?.node;
    return node ? { id: String(node.attrs.id ?? ""), author: String(node.attrs.author ?? ""), text: node.textContent } : null;
  });
}

async function typeIn(p: Person, text: string): Promise<void> {
  await p.page.keyboard.type(text, { delay: KEY_MS });
}

async function backspace(p: Person, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await p.page.keyboard.press("Backspace", { delay: KEY_MS });
}

async function shown(p: Person): Promise<string[]> {
  return p.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".thread-doc section.blk")].map((s) => {
      const n = (s as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown>; textContent: string } } }).pmViewDesc?.node;
      const flags = ["is-hidden", "is-mine", "is-empty"].filter((c) => s.classList.contains(c)).join(" ");
      return `${String(n?.attrs.author ?? "?")} ${n?.attrs.sent ? "sent" : "draft"} [${flags}] ${JSON.stringify(n?.textContent ?? "")}`;
    }),
  );
}

let failed = 0;
async function harrySends(what: string, jow: Person, harry: Person, text: string): Promise<void> {
  await typeIn(harry, text);
  const typed = await here(harry);
  await harry.page.keyboard.press(SEND);
  await Bun.sleep(SETTLE_MS);
  const out = await bot("show", "general");
  const went = out.split("\n").some((l) => l.includes("harry") && l.trim().endsWith(text));
  const why = !typed
    ? "harry's caret is in no line"
    : typed.author !== "harry"
      ? `harry typed into a line by ${JSON.stringify(typed.author)} (${typed.id.slice(0, 6)} ${JSON.stringify(typed.text)})`
      : !went
        ? "harry's line never went out"
        : null;
  if (why) failed++;
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
  if (why || process.env.OWNER_DEBUG) {
    for (const p of [jow, harry]) console.log(`    ${p.label} sees:\n${(await shown(p)).map((l) => `      ${l}`).join("\n")}`);
    console.log(
      `    CLI:\n${out
        .split("\n")
        .filter((l) => l.trim())
        .slice(-6)
        .map((l) => `      ${l.trim()}`)
        .join("\n")}`,
    );
  }
}

const want = (name: string): boolean => !ONLY || ONLY.split(",").includes(name);

try {
  const jow = await person("jow", BASE);
  const code = await newChannel(jow.page, "owner");
  let botIn = false;
  const joining = kiwi(["join", code, "owner", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(jow.page, () => !botIn);
  await joining;
  const harry = await person("harry", BASE);
  await joinAs(harry, BASE, code, jow.page);
  await general(jow);
  await general(harry);
  console.log("ok  jow and harry each have #general open, in their own browser");

  if (want("idle")) {
    await startLine(jow);
    await Bun.sleep(1500);
    await startLine(harry);
    await harrySends("jow sits on an empty line; harry clicks below and sends", jow, harry, "harry com jow parado");
  }

  if (want("deleted")) {
    await startLine(jow);
    await typeIn(jow, "abc");
    await backspace(jow, 3);
    await Bun.sleep(1500);
    await startLine(harry);
    await harrySends("jow types and deletes his line; harry clicks below and sends", jow, harry, "harry depois do apagado");
  }

  if (want("sent")) {
    await startLine(jow);
    await typeIn(jow, "jow manda");
    await jow.page.keyboard.press(SEND);
    await startLine(harry);
    await harrySends("jow sends; harry clicks below at once and sends", jow, harry, "harry logo depois");
  }

  if (want("race")) {
    jow.slow.ms = 1500;
    harry.slow.ms = 1500;
    await Promise.all([startLine(jow), startLine(harry)]);
    await typeIn(jow, "jow na corrida");
    await harrySends("both click the end line before either claim syncs (1.5 s lag)", jow, harry, "harry na corrida");
    jow.slow.ms = 0;
    harry.slow.ms = 0;
    await jow.page.keyboard.press(SEND);
  }

  if (want("arrow")) {
    await startLine(jow);
    await Bun.sleep(1500);
    await startLine(harry);
    await typeIn(harry, "harry em cima");
    await harry.page.keyboard.press("ArrowUp");
    await harry.page.keyboard.press("ArrowDown");
    await harry.page.keyboard.press("ArrowDown");
    await harry.page.keyboard.press("End");
    await harrySends("harry arrows around jow's empty line and keeps typing", jow, harry, " e embaixo");
  }

  if (want("click")) {
    await startLine(jow);
    await typeIn(jow, "x");
    await backspace(jow, 1);
    await Bun.sleep(1500);
    const lines = harry.page.locator(".thread-doc section.blk");
    const n = await lines.count();
    for (let i = n - 1; i >= 0; i--) {
      const box = await lines.nth(i).boundingBox();
      if (!box || box.height === 0) continue;
      await harry.page.mouse.click(box.x + box.width / 2, box.y + box.height + 4);
      break;
    }
    await harrySends("harry clicks just under the last line he can see and sends", jow, harry, "harry clicou embaixo");
  }
  if (want("windows")) {
    const more = [await person("jow", BASE, jow), await person("jow", BASE, jow)];
    for (const w of more) await general(w);
    for (const w of [jow, ...more]) {
      await startLine(w);
      await Bun.sleep(700);
    }
    await Bun.sleep(1500);
    await startLine(harry);
    await harrySends("jow has an empty line in each of 3 windows; harry clicks below and sends", jow, harry, "harry com tres janelas do jow");
    await startLine(more[0]!);
    await typeIn(more[0]!, "jow na segunda janela");
    await startLine(harry);
    await harrySends("jow types in his 2nd window while harry types and sends", jow, harry, "harry junto da segunda janela");
  }
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
for (const e of errors.slice(0, 5)) console.log(`✗ page error: ${e}`);
if (failed || errors.length) {
  console.error(`${failed} times harry's line wasn't his or didn't go out, in ${ENGINE}`);
  process.exitCode = 1;
}
