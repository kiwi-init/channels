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
const OLD = arg("old-dist");
const ENGINE = process.argv.includes("--chromium") ? "chromium" : "webkit";
const ONLY = arg("only");
const SAME = process.argv.includes("--same-person");
const KEY_MS = 90;
const SETTLE_MS = 2500;

const data = mkdtempSync(join(tmpdir(), "kiwi-doc-two-"));
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
const bot = (...args: string[]): Promise<string> => kiwi(["-c", "two", "--as", "bot", ...args]);

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const oldServer = OLD
  ? Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        const path = decodeURIComponent(url.pathname);
        const file = Bun.file(join(OLD, path === "/" || !path.includes(".") ? "index.html" : path));
        if (req.method === "GET" && (await file.exists()) && !path.startsWith("/v1/")) return new Response(file);
        return fetch(`${BASE.slice(0, -1)}${url.pathname}${url.search}`, { method: req.method, headers: req.headers, body: req.body });
      },
    })
  : null;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const errors: string[] = [];

interface Person {
  label: string;
  name: string;
  page: Page;
  slow: { ms: number; sockets: WebSocketRoute[] };
}

async function person(name: string, base: string, from?: BrowserContext, label = name): Promise<Person> {
  const storageState = from ? await from.storageState({ indexedDB: true }) : undefined;
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1280, height: 860 }, storageState });
  const slow = { ms: 0, sockets: [] as WebSocketRoute[] };
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    slow.sockets.push(ws);
    const later = (send: () => void) => (slow.ms ? void setTimeout(send, slow.ms) : send());
    ws.onMessage((m) => later(() => server.send(m)));
    server.onMessage((m) => later(() => ws.send(m)));
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base);
  if (!from) await firstRun(page, name);
  return { name, label, page, slow };
}

async function joinAs(p: Person, base: string, code: string, owner: Page): Promise<void> {
  await p.page.goto(`${base}#${code}`);
  await p.page.getByRole("button", { name: "Ask to join" }).click({ timeout: 20000 });
  if (process.env.TWO_DEBUG) {
    await Bun.sleep(8000);
    await p.page.screenshot({ path: `${process.env.TWO_DEBUG}-joiner.png` });
    await owner.screenshot({ path: `${process.env.TWO_DEBUG}-owner.png` });
    await owner
      .getByRole("navigation", { name: "Views" })
      .getByRole("button", { name: /^Needs you/ })
      .click()
      .catch(() => undefined);
    await Bun.sleep(1000);
    await owner.screenshot({ path: `${process.env.TWO_DEBUG}-owner-needs.png` });
  }
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

async function claimed(p: Person): Promise<string> {
  return p.page.evaluate(() => {
    const at = getSelection()?.anchorNode ?? null;
    const el = at instanceof Element ? at : (at?.parentElement ?? null);
    const section = el?.closest<HTMLElement>(".thread-doc section.blk");
    if (!section) return "(no line)";
    const attrs = (section as unknown as { pmViewDesc?: { node?: { attrs: Record<string, unknown> } } }).pmViewDesc?.node?.attrs ?? {};
    return `block ${String(attrs.id ?? section.dataset.block)} author ${JSON.stringify(attrs.author)} by ${JSON.stringify(attrs.by ?? "(no by attr)")}`;
  });
}

async function probe(what: string, ...people: Person[]): Promise<void> {
  for (const p of people) console.log(`    ${what}: ${p.label} is in ${await claimed(p)}`);
}

async function typeIn(p: Person, text: string): Promise<void> {
  if (!process.env.TWO_WATCH) return p.page.keyboard.type(text, { delay: KEY_MS });
  let was = await claimed(p);
  console.log(`      ${p.label} types ${JSON.stringify(text)} from ${was}`);
  for (const ch of text) {
    await p.page.keyboard.type(ch);
    await Bun.sleep(KEY_MS);
    const now = await claimed(p);
    if (now !== was) console.log(`      ${p.label} after ${JSON.stringify(ch)} jumped to ${now}`);
    was = now;
  }
}
async function backspace(p: Person, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await p.page.keyboard.press("Backspace", { delay: KEY_MS });
}

async function docLines(): Promise<string[]> {
  const out = await bot("show", "general");
  return out.split("\n").map((l) => l.trim());
}

const has = (lines: readonly string[], who: string, text: string): boolean => lines.some((l) => l.includes(`${who}`) && l.endsWith(text.trimEnd()));

let failed = 0;
async function check(what: string, wants: readonly [string, string][]): Promise<void> {
  await Bun.sleep(SETTLE_MS);
  const lines = await docLines();
  const missing = wants.filter(([who, text]) => !has(lines, who, text));
  if (missing.length) {
    failed++;
    console.log(`✗ ${what}: lost ${missing.map(([w, t]) => `${w}'s ${JSON.stringify(t)}`).join(", ")}`);
    console.log(
      lines
        .filter((l) => l)
        .slice(-12)
        .map((l) => `    ${JSON.stringify(l)}`)
        .join("\n"),
    );
  } else console.log(`✓ ${what}`);
}

async function sameLine(what: string, owner: Person, other: Person): Promise<void> {
  await startLine(owner);
  await typeIn(owner, "abc ");
  await Bun.sleep(800);
  const line = owner.page.locator(`.thread-doc section.blk p`).filter({ hasText: "abc" }).last();
  const otherLine = other.page.locator(`.thread-doc section.blk p`).filter({ hasText: "abc" }).last();
  await otherLine.click();
  await other.page.keyboard.press("End");
  await Promise.all([typeIn(owner, "def ghi"), typeIn(other, " XYZ")]);
  await Bun.sleep(SETTLE_MS);
  const text = (await line.innerText().catch(() => "")).replace(/\s+/g, " ");
  const lines = await docLines();
  const doc = lines.find((l) => l.includes("abc")) ?? "";
  const lost = [..."abcdefghiXYZ"].filter((ch) => !doc.includes(ch) || !text.includes(ch));
  if (lost.length) {
    failed++;
    console.log(`✗ ${what}: letters ${lost.join("")} are gone (doc ${JSON.stringify(doc)}, ${owner.name} sees ${JSON.stringify(text)})`);
  } else console.log(`✓ ${what}: ${JSON.stringify(doc)}`);
  await owner.page.keyboard.press("Enter");
}

let posting = true;
let agentLine = 0;
async function agent(): Promise<void> {
  while (posting) {
    const n = ++agentLine;
    const sent = await bot("send", "--to", "#general", `Agent line ${n}: building`).catch((e: unknown) => (errors.push(String(e)), ""));
    const seq = /#(\d+)/.exec(sent)?.[1];
    for (let k = 1; seq && posting && k <= 3; k++) {
      await Bun.sleep(250);
      await bot("edit", seq, `Agent line ${n}: building, step ${k} of 3`).catch((e: unknown) => errors.push(String(e)));
    }
    await Bun.sleep(400);
  }
}

const want = (name: string): boolean => !ONLY || ONLY.split(",").includes(name);

try {
  const jow = await person("jow", BASE);
  const code = await newChannel(jow.page, "two");
  let botIn = false;
  const joining = kiwi(["join", code, "two", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(jow.page, () => !botIn);
  await joining;
  const dadBase = oldServer ? `http://127.0.0.1:${oldServer.port}/` : BASE;
  const dad = SAME ? await person("jow", BASE, jow.page.context(), "jow's 2nd app") : await person("dad", dadBase);
  if (!SAME) await joinAs(dad, dadBase, code, jow.page);
  await general(jow);
  await general(dad);
  console.log(`ok  jow and ${dad.label} (${oldServer ? "on the old UI" : "on this UI"}) each have #general open, in their own browser; an agent posts and edits lines`);
  void agent();
  await Bun.sleep(1500);

  if (want("own")) {
    await Promise.all([startLine(jow), startLine(dad)]);
    await probe("own", jow, dad);
    await Promise.all([typeIn(jow, "Salve mister :)").then(() => backspace(jow, 6)), typeIn(dad, "bom dia pessoal")]);
    await check("both type in their own lines, jow deletes 6", [
      ["jow", "Salve mis"],
      [dad.name, "bom dia pessoal"],
    ]);
    await Promise.all([jow.page.keyboard.press("Enter"), dad.page.keyboard.press("Enter")]);
  }

  if (want("enter")) {
    await Promise.all([startLine(jow), startLine(dad)]);
    await probe("enter", jow, dad);
    await Promise.all([
      typeIn(jow, "first line").then(async () => {
        await jow.page.keyboard.press("Enter");
        await typeIn(jow, "second line");
        await backspace(jow, 4);
        await jow.page.keyboard.press("Enter");
      }),
      typeIn(dad, "dad keeps typing here while jow sends"),
    ]);
    await check("jow presses Enter and Backspace while dad types", [
      ["jow", "first line"],
      ["jow", "second "],
      [dad.name, "dad keeps typing here while jow sends"],
    ]);
    await dad.page.keyboard.press("Enter");
  }

  if (want("idle")) {
    await startLine(dad);
    await startLine(jow);
    await typeIn(jow, "dad sits on an empty line");
    await backspace(jow, 5);
    await typeIn(jow, " line");
    await check("dad idles on an empty line while jow types and deletes", [["jow", "dad sits on an empty line"]]);
    await jow.page.keyboard.press("Enter");
  }

  if (want("same")) await sameLine("jow and dad type in the same line", jow, dad);

  if (want("race")) {
    jow.slow.ms = 1500;
    dad.slow.ms = 1500;
    await Promise.all([startLine(jow), startLine(dad)]);
    await probe("race", jow, dad);
    await Promise.all([typeIn(jow, "jow claims the end line"), typeIn(dad, "the other copy claims it too")]);
    jow.slow.ms = 0;
    dad.slow.ms = 0;
    await probe("race after typing", jow, dad);
    await Bun.sleep(3000);
    await check("both focus the empty end line before either claim syncs", [
      [jow.name, "jow claims the end line"],
      [dad.name, "the other copy claims it too"],
    ]);
    await Promise.all([jow.page.keyboard.press("Enter"), dad.page.keyboard.press("Enter")]);
  }

  if (want("slow")) {
    if (process.env.TWO_WATCH) for (const p of [jow, dad]) p.page.on("console", (m) => m.text().startsWith("[two]") && console.log(`      ${p.label}: ${m.text()}`));
    dad.slow.ms = 400;
    await Promise.all([startLine(jow), startLine(dad)]);
    await probe("slow", jow, dad);
    await Promise.all([typeIn(jow, "jow on a fast line"), typeIn(dad, "dad on a slow relay")]);
    await check("dad's relay is 400 ms slow each way", [
      ["jow", "jow on a fast line"],
      [dad.name, "dad on a slow relay"],
    ]);
    await Promise.all([jow.page.keyboard.press("Enter"), dad.page.keyboard.press("Enter")]);
    await Promise.all([startLine(jow), startLine(dad)]);
    await Promise.all([
      typeIn(jow, "jow types through a reconnect"),
      typeIn(dad, "dad drops off").then(async () => {
        for (const s of dad.slow.sockets.splice(0)) await s.close().catch(() => undefined);
        await typeIn(dad, " and comes back");
      }),
    ]);
    dad.slow.ms = 0;
    await Bun.sleep(4000);
    await check("dad's socket drops mid-line and reconnects", [
      ["jow", "jow types through a reconnect"],
      [dad.name, "dad drops off and comes back"],
    ]);
  }
} finally {
  posting = false;
  await Bun.sleep(1000);
  await browser.close();
  oldServer?.stop(true);
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
for (const e of errors.slice(0, 5)) console.log(`note: ${e}`);
if (failed) {
  console.error(`${failed} checks lost letters someone typed, in ${ENGINE}`);
  process.exitCode = 1;
}
