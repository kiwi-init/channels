#!/usr/bin/env bun
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import * as Effect from "effect/Effect";
import { chromium, webkit, type Page } from "playwright-core";
import { AgentSession, oneLook, runAgent } from "../src/agent.ts";
import { loadConfig } from "../src/config.ts";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { composer, firstRun, letIn, newChannel, SEND } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv.find((a) => a.startsWith("--dist="))?.slice(7));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const LINES = Number(process.env.TREMBLE_LINES ?? 12);
const FLOOD = Number(process.env.TREMBLE_FLOOD ?? 560);

const data = mkdtempSync(join(tmpdir(), "kiwi-feed-tremble-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
writeFileSync(join(cli, "bin", "open"), "#!/bin/sh\nexit 0\n");
writeFileSync(join(cli, "bin", "xdg-open"), "#!/bin/sh\nexit 0\n");
chmodSync(join(cli, "bin", "open"), 0o755);
chmodSync(join(cli, "bin", "xdg-open"), 0o755);
process.env.KIWI_HOME = join(cli, "home");
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim()}`)))));
};

async function paste(page: Page, name: string): Promise<void> {
  await page.evaluate(async (file) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2d context");
    g.fillStyle = "#3a7";
    g.fillRect(0, 0, 320, 180);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("no png");
    const dt = new DataTransfer();
    dt.items.add(new File([blob], file, { type: "image/png" }));
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, name);
}

interface Swaps {
  frames: number;
  sets: number;
  writes: number;
  firsts: string[];
}

const watch = (page: Page, ms: number): Promise<Swaps> =>
  page.evaluate((span) => {
    return new Promise<Swaps>((done) => {
      const sets = new Map<string, number>();
      let frames = 0;
      let writes = 0;
      const feed = document.querySelector<HTMLElement>(".main .feed");
      const own = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
      if (feed && own?.set && own.get) {
        const set = own.set;
        const get = own.get;
        Object.defineProperty(feed, "scrollTop", {
          configurable: true,
          get() {
            return get.call(this);
          },
          set(v: number) {
            writes++;
            set.call(this, v);
          },
        });
      }
      const t0 = performance.now();
      const tick = () => {
        const seqs = [...document.querySelectorAll<HTMLElement>(".main .feed-list > [data-seq]")].map((r) => r.dataset.seq ?? "");
        const sig = seqs.join(",");
        sets.set(sig, (sets.get(sig) ?? 0) + 1);
        frames++;
        if (performance.now() - t0 < span) requestAnimationFrame(tick);
        else {
          if (feed) delete (feed as { scrollTop?: number }).scrollTop;
          done({ frames, sets: sets.size, writes, firsts: [...sets.keys()].map((k) => `${k.split(",").length} rows from ${k.split(",")[0]}`) });
        }
      };
      requestAnimationFrame(tick);
    });
  }, ms);

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = ENGINE === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const log = (...a: unknown[]) => console.log(`[${((performance.now() / 1000) | 0).toString().padStart(4)}s]`, ...a);

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "tremble");
  for (let i = 0; i < LINES; i++) {
    await composer(page).click();
    await paste(page, `shot-${i}.png`);
    await page.locator(".composer .compose-file").first().waitFor({ timeout: 10000 });
    await page.keyboard.type(`line ${i} with a picture`);
    await page.keyboard.press(SEND);
    await page.waitForTimeout(700);
  }
  log(`${LINES} lines with pictures sent`);
  let joined = 0;
  const joining = Promise.all(["bot", "helper"].map((n) => kiwi(["join", code, "tremble", "--relay", BASE, "--as", n]).then(() => void joined++)));
  await letIn(page, () => joined < 2);
  await joining;
  log("bot and helper in");
  const bot = await AgentSession.open("tremble", loadConfig().channels["tremble"]!, "bot");
  const send = (body: string, to?: string[]) => runAgent(oneLook(bot.send(body, { kind: "msg", ...(to ? { to, dm: true } : {}) })));
  for (let i = 0; i < FLOOD; i++) await (i % 25 === 24 ? send(`room note ${i}`) : send(`direct ${i}`, ["jow"]));
  for (let i = 0; i < 4; i++) await send(`room line ${i}`);
  log(`${FLOOD} direct messages and 4 room lines sent`);
  if (process.argv.includes("--reload")) {
    await page.reload();
    await page.locator(".main .feed-list [data-seq]").first().waitFor({ timeout: 30000 });
    log("reloaded");
  }
  await page.waitForTimeout(5000);
  const trace: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("TRB ")) trace.push(text.slice(4));
  });
  if (ENGINE === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const points: { re: RegExp; label: string; expr: (m: RegExpExecArray) => string }[] = [
      { re: /keep\((\w+),(\w+)\)\{/, label: "keep", expr: (m) => `console.log("TRB keep", Math.round(performance.now()), ${m[1]}, ${m[2]}, JSON.stringify([...this.holds]), this.p.back.peek().length, this.p.back.peek()[0]?.seq ?? null, (new Error().stack || "").split("\\n").slice(2, 7).map((s) => s.trim()).join(" < "))` },
      { re: /more\(\)\{/, label: "more", expr: () => `console.log("TRB more", Math.round(performance.now()), this.p.shown.peek()[0]?.seq ?? null, this.done, !!this.paging, this.p.back.peek().length)` },
      { re: /(\w+)\.length&&\(this\.p\.back\.value=\[\.\.\.\1,\.\.\.this\.p\.back\.peek\(\)\]\)/, label: "grow", expr: (m) => `console.log("TRB grow", Math.round(performance.now()), ${m[1]}.length, ${m[1]}[0]?.seq ?? null, this.p.back.peek().length)` },
    ];
    cdp.on("Debugger.scriptParsed", async (e: { scriptId: string; url: string }) => {
      if (!e.url.endsWith(".js")) return;
      const { scriptSource } = (await cdp.send("Debugger.getScriptSource", { scriptId: e.scriptId })) as { scriptSource: string };
      if (!scriptSource.includes("this.holds")) return;
      for (const p of points) {
        const m = p.re.exec(scriptSource);
        if (!m) {
          log(`no ${p.label} site in ${e.url}`);
          continue;
        }
        const at = m.index + (p.label === "grow" ? 0 : m[0].length);
        const before = scriptSource.slice(0, at).split("\n");
        await cdp.send("Debugger.setBreakpoint", { location: { scriptId: e.scriptId, lineNumber: before.length - 1, columnNumber: before[before.length - 1]!.length }, condition: `(${p.expr(m)}, false)` });
        log(`logpoint ${p.label} in ${e.url}`);
      }
    });
    await cdp.send("Debugger.enable");
  }
  log("live, before removal:", JSON.stringify(await watch(page, 4000)));
  await page.locator(".side-member", { hasText: "helper" }).first().click({ button: "right" });
  await page.getByText("View profile", { exact: true }).click();
  await page.getByText("Remove from channel…", { exact: true }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  log("helper removed");
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(2000);
    log(`after removal ${i}:`, JSON.stringify(await watch(page, 3000)));
  }
  log(`trace (${trace.length}):\n${trace.slice(0, 60).join("\n")}`);
  log("page:", JSON.stringify(await page.evaluate(() => ({
    editors: document.querySelectorAll(".ProseMirror").length,
    threadDocs: document.querySelectorAll(".thread-doc").length,
    rows: [...document.querySelectorAll<HTMLElement>(".main .feed-list > [data-seq]")].map((r) => `${r.dataset.seq}:${r.className}:${(r.textContent ?? "").slice(0, 30)}`),
    older: [...document.querySelectorAll(".main .feed *")].filter((e) => /older|earlier/i.test(e.className)).map((e) => e.className).slice(0, 5),
  }))));
  if (process.argv.includes("--hold")) await page.waitForTimeout(600000);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
void Effect;
