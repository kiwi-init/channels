#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type BrowserContext, type Page, type WebSocketRoute } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel, SEND } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = harnessDist(arg("dist"));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
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
    .waitFor({ state: "attached", timeout: 120000 })
    .then(() => void (inside = true));
  await letIn(owner, () => !inside);
  await waiting;
}

async function general(p: Person): Promise<void> {
  await p.page
    .getByRole("navigation", { name: "Views" })
    .getByRole("button", { name: /general/ })
    .click();
  await p.page.locator(".thread-doc").first().waitFor({ state: "attached", timeout: 30000 });
}

async function typeIn(p: Person, text: string): Promise<void> {
  await composer(p.page).click();
  await p.page.keyboard.type(text, { delay: KEY_MS });
}

async function shown(p: Person): Promise<string[]> {
  return p.page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".main article.msg, .main .thread-doc section.blk:not(.is-hidden)")]
      .slice(-6)
      .map((r) => `${r.tagName.toLowerCase()} ${JSON.stringify(r.innerText.slice(0, 80))}`),
  );
}

let failed = 0;
interface Posted {
  from: string;
  body: string;
  block?: { id: string };
}

const isPosted = (m: unknown): m is Posted => !!m && typeof m === "object" && "from" in m && typeof m.from === "string" && "body" in m && typeof m.body === "string";

async function posted(): Promise<Posted[]> {
  const out = await bot("log", "--json", "-n", "300");
  return out.split("\n").flatMap((l): Posted[] => {
    try {
      const m: unknown = JSON.parse(l);
      return isPosted(m) ? [m] : [];
    } catch {
      // kiwi log --json can print a note line (compacted history) that isn't a message.
      return [];
    }
  });
}

async function sentAs(from: string, text: string, waitMs: number): Promise<Posted[]> {
  const end = Date.now() + waitMs;
  for (;;) {
    const got = (await posted()).filter((m) => m.from === from && m.body.trim() === text);
    if (got.length || Date.now() > end) return got;
    await Bun.sleep(300);
  }
}

async function report(what: string, why: string | null, jow: Person, harry: Person): Promise<void> {
  if (why) failed++;
  console.log(`${why ? "✗" : "✓"} ${what}${why ? `: ${why}` : ""}`);
  if (!why && !process.env.OWNER_DEBUG) return;
  for (const p of [jow, harry]) console.log(`    ${p.label} sees:\n${(await shown(p)).map((l) => `      ${l}`).join("\n")}`);
  console.log(
    `    sent:\n${(await posted())
      .slice(-6)
      .map((m) => `      ${m.from} ${m.block?.id.slice(0, 6) ?? "(no line)"} ${JSON.stringify(m.body)}`)
      .join("\n")}`,
  );
}

async function wentOut(from: string, text: string): Promise<string | null> {
  const got = await sentAs(from, text, SETTLE_MS * 4);
  if (!got.length) return `${from}'s ${JSON.stringify(text)} never went out`;
  if (got.length > 1) return `${from}'s ${JSON.stringify(text)} went out ${got.length} times`;
  if (!got[0]!.block?.id) return `${from}'s ${JSON.stringify(text)} went out as a plain message, not a line of the doc`;
  return null;
}

async function bothSend(what: string, jow: Person, harry: Person, mine: string, his: string): Promise<void> {
  await Promise.all([typeIn(jow, mine), typeIn(harry, his)]);
  await Promise.all([jow.page.keyboard.press(SEND), harry.page.keyboard.press(SEND)]);
  const why = (await wentOut("jow", mine)) ?? (await wentOut("harry", his));
  await report(what, why, jow, harry);
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

  if (want("enter")) {
    await composer(harry.page).click();
    await harry.page.keyboard.type("harry so deu shift enter", { delay: KEY_MS });
    await harry.page.keyboard.press("Shift+Enter");
    await harry.page.keyboard.type("e segue", { delay: KEY_MS });
    const early = await sentAs("harry", "harry so deu shift enter", SETTLE_MS);
    await harry.page.keyboard.press(SEND);
    const why = early.length ? "Shift+Enter sent harry's line" : await wentOut("harry", "harry so deu shift enter\ne segue");
    await report("harry presses Shift+Enter: the line stays his draft; Enter then sends both lines as one", why, jow, harry);
  }

  if (want("sent")) {
    await bothSend("jow and harry send at the same moment, each from his own composer", jow, harry, "jow manda", "harry logo depois");
  }

  if (want("race")) {
    jow.slow.ms = 1500;
    harry.slow.ms = 1500;
    await bothSend("both send before either's line syncs (1.5 s lag)", jow, harry, "jow na corrida", "harry na corrida");
    jow.slow.ms = 0;
    harry.slow.ms = 0;
  }

  if (want("windows")) {
    const more = [await person("jow", BASE, jow), await person("jow", BASE, jow)];
    for (const w of more) await general(w);
    await typeIn(more[0]!, "jow rascunho na segunda janela");
    await bothSend("jow drafts in his 2nd window while jow and harry send from their first", jow, harry, "jow com tres janelas", "harry com tres janelas do jow");
    await composer(more[1]!.page).click();
    await more[1]!.page.keyboard.type("jow na terceira janela", { delay: KEY_MS });
    await more[1]!.page.keyboard.press(SEND);
    const draft = await composer(more[0]!.page).inputValue();
    const why = (await wentOut("jow", "jow na terceira janela")) ?? (draft === "jow rascunho na segunda janela" ? null : `the 2nd window's draft reads ${JSON.stringify(draft)}`);
    await report("jow sends from his 3rd window; his 2nd window keeps its own draft", why, jow, harry);
  }
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
for (const e of errors.slice(0, 5)) console.log(`✗ page error: ${e}`);
if (failed || errors.length) {
  console.error(`${failed} times a line didn't go out once, as its sender's line of the doc, in ${ENGINE}`);
  process.exitCode = 1;
}
