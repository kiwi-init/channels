#!/usr/bin/env bun
import { execSync, spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webkit } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { docOpen, firstRun, letIn, newChannel } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv[2]!);
const OUT = process.argv[3]!;
const TAG = process.argv[4] ?? "run";
const IDLE_MIN = Number(process.env.IDLE_MIN ?? 7.5);
const data = mkdtempSync(join(tmpdir(), "kiwi-t5361-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const name of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", name), 0o755);
}
const cliEnv = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const kiwi = (args: string[]): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => void (out += d.toString("utf8"));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim()}`)))));
};
const rss = () => {
  const rows = execSync("ps -axo rss=,command=")
    .toString()
    .split("\n")
    .filter((l) => /playwright/i.test(l) && /WebContent|WebProcess/i.test(l));
  return { procs: rows.length, mb: Math.round(rows.reduce((n, l) => n + Number(l.trim().split(/\s+/)[0]), 0) / 102.4) / 10 };
};
const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await webkit.launch();
const net = { requests: 0, up: 0, down: 0, sockets: 0, framesUp: 0, framesDown: 0, wsUp: 0, wsDown: 0, paths: {} as Record<string, number> };
const take = () => {
  const s = { ...net, paths: { ...net.paths } };
  return s;
};
const diff = (a: ReturnType<typeof take>, b: ReturnType<typeof take>) => ({
  requests: b.requests - a.requests,
  httpKB: Math.round((b.up + b.down - a.up - a.down) / 102.4) / 10,
  sockets: b.sockets - a.sockets,
  frames: b.framesUp + b.framesDown - a.framesUp - a.framesDown,
  wsKB: Math.round((b.wsUp + b.wsDown - a.wsUp - a.wsDown) / 102.4) / 10,
  paths: Object.fromEntries(Object.entries(b.paths).flatMap(([k, v]) => (v - (a.paths[k] ?? 0) ? [[k, v - (a.paths[k] ?? 0)]] : []))),
});
try {
  const page = await browser.newPage({ viewport: { width: 1380, height: 860 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  page.on("requestfinished", (req) => {
    const u = new URL(req.url());
    if (/\.(js|css|woff2?|png|svg|ico|html|json|wasm)$/.test(u.pathname) || u.pathname === "/") return;
    net.requests++;
    const key = `${req.method()} ${u.pathname.replace(/[A-Za-z0-9_-]{16,}/g, ":id")}`;
    net.paths[key] = (net.paths[key] ?? 0) + 1;
    void req
      .sizes()
      .then((s) => {
        net.up += s.requestBodySize + s.requestHeadersSize;
        net.down += s.responseBodySize + s.responseHeadersSize;
      })
      .catch(() => {});
  });
  page.on("websocket", (ws) => {
    net.sockets++;
    ws.on("framesent", (f) => (net.framesUp++, (net.wsUp += f.payload.length)));
    ws.on("framereceived", (f) => (net.framesDown++, (net.wsDown += f.payload.length)));
  });
  await page.goto(BASE);
  await firstRun(page, "jow");
  const code = await newChannel(page, "alpha");
  let botIn = false;
  const joining = kiwi(["join", code, "alpha", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(page, () => !botIn);
  await joining;
  await docOpen(page);
  for (let i = 2; i <= 9; i++) await newChannel(page, `chan${i}`);
  await newChannel(page, "beta");
  const tiles = () =>
    page
      .locator(".rail .tile:not(.is-add)")
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.getAttribute("aria-label") ?? e.getAttribute("title") ?? (e.textContent ?? "").trim()}${e.querySelector(".tile-badge") ? " [badge " + e.querySelector(".tile-badge")!.textContent + "]" : e.querySelector(".tile-dot") ? " [dot]" : ""}`,
        ),
      );
  console.log(TAG, "10 channels, beta open:", JSON.stringify(await tiles()));
  await page.waitForTimeout(5000);
  const start = take();
  console.log(TAG, "idle start rss", JSON.stringify(rss()));
  let prev = start;
  for (let m = 1; m <= Math.ceil(IDLE_MIN * 2); m++) {
    await page.waitForTimeout(30000);
    const now = take();
    console.log(TAG, `idle +${m * 30}s`, JSON.stringify(diff(prev, now)), "rss", JSON.stringify(rss()));
    prev = now;
  }
  console.log(TAG, `idle total over ${IDLE_MIN} min`, JSON.stringify(diff(start, prev)));
  const alpha = async () => (await tiles()).find((t) => t.startsWith("alpha")) ?? "";
  const until = async (badge: string, limitS: number) => {
    const t0 = Date.now();
    while (Date.now() - t0 < limitS * 1000) {
      if ((await alpha()).includes(`[badge ${badge}]`)) return Math.round((Date.now() - t0) / 100) / 10;
      await page.waitForTimeout(1000);
    }
    return null;
  };
  const before = take();
  const waitingIn = ["bot2", "bot3"].map((name) => kiwi(["join", code, `alpha-${name}`, "--relay", BASE, "--as", name]).catch(() => ""));
  console.log(TAG, "two agents ask to join alpha; seconds until alpha shows 2:", await until("2", 150), "| alpha tile:", await alpha());
  await page.screenshot({ path: join(OUT, `${TAG}-in-beta.png`), clip: { x: 0, y: 0, width: 620, height: 420 } });
  void kiwi(["join", code, "alpha-bot4", "--relay", BASE, "--as", "bot4"]).catch(() => "");
  void waitingIn;
  console.log(TAG, "a third asks; seconds until alpha shows 3:", await until("3", 150), "| alpha tile:", await alpha());
  console.log(TAG, "network over the asks phase", JSON.stringify(diff(before, take())), "rss", JSON.stringify(rss()));
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
