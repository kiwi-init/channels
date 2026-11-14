import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { pageErrors } from "./page-errors.ts";
import { firstRun, letIn, newChannel, say } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

export type Engine = "chromium" | "webkit";

export interface Stage {
  page: Page;
  dir: string;
  threw: string[];
  bot: (text: string, more?: string[]) => Promise<string>;
  close: () => Promise<void>;
}

const ROOT = resolve(import.meta.dir, "..");

export const engineOf = (argv: string[]): Engine => (argv.includes("--webkit") ? "webkit" : "chromium");

export async function openStage(channel: string, engine: Engine, seeds: number, prepare?: (page: Page) => Promise<void>): Promise<Stage> {
  const dir = mkdtempSync(join(tmpdir(), `kiwi-feed-${channel}-`));
  const cli = join(dir, "cli");
  mkdirSync(join(cli, "bin"), { recursive: true });
  mkdirSync(join(dir, "relay"));
  for (const opener of ["open", "xdg-open"]) {
    writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
    chmodSync(join(cli, "bin", opener), 0o755);
  }
  const env = { KIWI_MODEL: "test-model", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
  const running: ChildProcess[] = [];
  const kiwi = (args: string[]): Promise<string> => {
    const proc = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env });
    running.push(proc);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => (out += d));
    return new Promise((ok, fail) =>
      proc.on("exit", (code) => {
        running.splice(running.indexOf(proc), 1);
        if (code === 0) ok(out);
        else fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`));
      }),
    );
  };
  const { relay, port } = await startLocalRelay(join(dir, "relay"), harnessDist(), { rateLimits: false });
  const base = `http://127.0.0.1:${port}/`;
  const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })).catch((err: unknown) => {
    relay.kill();
    rmSync(dir, { recursive: true, force: true });
    throw err;
  });
  const close = async (): Promise<void> => {
    for (const p of running) p.kill();
    await browser.close();
    relay.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const threw: string[] = [];
    await pageErrors(page, (e) => threw.push(e));
    await prepare?.(page);
    await page.goto(base);
    await firstRun(page, "jow");
    const code = await newChannel(page, channel);
    let joined = false;
    const joining = kiwi(["join", code, channel, "--relay", base, "--as", "bot"]).then(() => void (joined = true));
    await letIn(page, () => !joined);
    await joining;
    for (let i = 0; i < seeds; i++) {
      await say(page, `seed line ${i}`);
      await page.waitForTimeout(70);
    }
    await page
      .locator(".main article.msg")
      .filter({ hasText: `seed line ${seeds - 1}` })
      .first()
      .waitFor({ timeout: 30_000 });
    return { page, dir, threw, bot: (text, more = []) => kiwi(["-c", channel, "--as", "bot", "send", "--to", "#general", text, ...more]), close };
  } catch (err) {
    await close();
    throw err;
  }
}
