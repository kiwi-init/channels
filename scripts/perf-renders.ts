#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { docOpen, firstRun, letIn, newChannel, say } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const flag = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = harnessDist(flag("dist"));
const ENGINE = process.argv.includes("--webkit") ? "webkit" : "chromium";
const SENDS = Number(flag("sends") ?? 10);
const OUT = flag("json");

const data = mkdtempSync(join(tmpdir(), "kiwi-perf-renders-"));
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

interface Counted {
  commits: number;
  renders: number;
}

function countRenders(): void {
  const counted = { commits: 0, renders: 0 };
  const rendering = new Set([0, 1, 11, 14, 15]);
  Object.assign(window, {
    __renders: counted,
    __REACT_DEVTOOLS_GLOBAL_HOOK__: {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      onCommitFiberRoot: (_: number, root: { current: object }) => {
        counted.commits += 1;
        type Fiber = { tag: number; flags: number; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null };
        const walk = (fiber: Fiber | null): void => {
          for (let f = fiber; f; f = f.sibling) {
            if (rendering.has(f.tag) && f.flags & 1) counted.renders += 1;
            if (!f.alternate || f.child !== f.alternate.child) walk(f.child);
          }
        };
        walk(root.current as Fiber);
      },
    },
  });
}

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST, { rateLimits: false });
const BASE = `http://127.0.0.1:${port}/`;
const browser = await (ENGINE === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })).catch((err: unknown) => {
  relay.kill();
  throw err;
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript(countRenders);
  await page.goto(BASE);
  await firstRun(page, "jow");
  const busy = await newChannel(page, "busy");
  let botIn = false;
  const joining = kiwi(["join", busy, "busy", "--relay", BASE, "--as", "bot"]).then(() => void (botIn = true));
  await letIn(page, () => !botIn);
  await joining;
  await kiwi(["-c", "busy", "--as", "bot", "send", "--to", "#general", "a first line, before counting"]);
  await newChannel(page, "quiet");
  await docOpen(page);
  for (let i = 0; i < 20; i++) await say(page, `a line of mine, number ${i + 1}`);
  await page.waitForTimeout(5000);

  const read = (): Promise<Counted> => page.evaluate(() => ({ ...(window as unknown as { __renders: Counted }).__renders }));
  const idleFrom = await read();
  await page.waitForTimeout(SENDS * 1500);
  const idleTo = await read();
  const from = await read();
  for (let i = 0; i < SENDS; i++) await kiwi(["-c", "busy", "--as", "bot", "send", "--to", "#general", `an agent's line in the other channel, number ${i + 1}`]);
  await page.waitForTimeout(4000);
  const to = await read();

  const unread = await page
    .locator(".rail")
    .innerText()
    .catch(() => "");
  const result = {
    engine: ENGINE,
    sends: SENDS,
    idleRenders: idleTo.renders - idleFrom.renders,
    idleCommits: idleTo.commits - idleFrom.commits,
    renders: to.renders - from.renders,
    commits: to.commits - from.commits,
    rendersPerMessage: Math.round(((to.renders - from.renders) / SENDS) * 10) / 10,
    commitsPerMessage: Math.round(((to.commits - from.commits) / SENDS) * 10) / 10,
  };
  if (!to.commits) throw new Error("React never reported a commit: the counting hook didn't attach");
  console.log(`components rendered while ${SENDS} messages arrived in a channel that isn't open, with a 20-line channel on screen (${ENGINE}):`);
  console.log(`  ${result.renders} renders in ${result.commits} commits: ${result.rendersPerMessage} renders and ${result.commitsPerMessage} commits per message`);
  console.log(`  the same wait with nothing arriving: ${result.idleRenders} renders in ${result.idleCommits} commits`);
  console.log(`  the rail reads: ${unread.replace(/\s+/g, " ").trim().slice(0, 80)}`);
  if (OUT) writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
