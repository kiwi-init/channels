#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { composer, firstRun, letIn, newChannel, say, SEND } from "./perf-ui.ts";
import { harnessDist } from "./ui-harness.ts";

const ROOT = resolve(import.meta.dir, "..");
const BURST = 6;
const MODES = (process.argv.find((a) => a.startsWith("--modes="))?.slice(8) ?? "idle,sent,busy").split(",");
const ENGINES = (process.argv.find((a) => a.startsWith("--engines="))?.slice(10) ?? "chromium,webkit").split(",");

interface View {
  top: number;
  below: number;
}

const view = (page: Page): Promise<View> =>
  page.evaluate(() => {
    const box = document.querySelector(".main .feed");
    if (!box) throw new Error("no feed");
    return { top: Math.round(box.scrollTop), below: Math.round(box.scrollHeight - box.clientHeight - box.scrollTop) };
  });

async function run(engine: string, browser: Browser): Promise<string[]> {
  const data = mkdtempSync(join(tmpdir(), "kiwi-doc-follow-"));
  const cli = join(data, "cli");
  mkdirSync(join(cli, "bin"), { recursive: true });
  mkdirSync(join(data, "relay"));
  for (const opener of ["open", "xdg-open"]) {
    writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
    chmodSync(join(cli, "bin", opener), 0o755);
  }
  const env = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
  const kiwi = (args: string[]): Promise<string> => {
    const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env });
    let out = "";
    const take = (d: Buffer) => void (out += d.toString("utf8"));
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))));
  };
  const { relay, port } = await startLocalRelay(join(data, "relay"), harnessDist(), { rateLimits: false });
  const failures: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(`http://127.0.0.1:${port}/`);
    await firstRun(page, "jow");
    const code = await newChannel(page, "follow");
    let joined = false;
    const joining = kiwi(["join", code, "follow", "--relay", `http://127.0.0.1:${port}/`, "--as", "bot"]).then(() => void (joined = true));
    await letIn(page, () => !joined);
    await joining;
    const burst = async (tag: string): Promise<void> => {
      for (let i = 0; i < BURST; i++) await kiwi(["-c", "follow", "--as", "bot", "send", "--to", "#general", `${tag} ${i}: the agent answers with a line long enough to take room`]);
    };
    await burst("seed");
    for (let i = 0; i < 12; i++) {
      await say(page, `seed line ${i}`);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1000);
    await page.mouse.move(5, 500);
    let working = false;
    let step = 0;
    const work = async (): Promise<void> => {
      while (working) {
        const sent = await kiwi(["-c", "follow", "--as", "bot", "send", "--to", "#general", `work ${step++}: working`]);
        const seq = /#(\d+)/.exec(sent)?.[1];
        if (seq && working) await kiwi(["-c", "follow", "--as", "bot", "edit", seq, `work ${step}: working, step 2`]);
      }
    };
    for (const mode of MODES) {
      await composer(page).click();
      if (mode !== "busy") await page.mouse.move(5, 500);
      let before: View = { top: 0, below: 0 };
      if (mode === "busy") {
        working = true;
        const loop = work();
        await page.waitForTimeout(1500);
        await composer(page).click();
        await page.keyboard.type("typing while the agent works, every letter should stay", { delay: 30 });
        await page.waitForTimeout(800);
        await page.keyboard.press(SEND);
        await page.waitForTimeout(1500);
        working = false;
        await loop;
      } else {
        if (mode === "sent") {
          await page.keyboard.type("my question to the agent");
          await page.keyboard.press(SEND);
        }
        await page.waitForTimeout(300);
        before = await view(page);
      }
      if (mode !== "busy") await burst(mode);
      await page.waitForTimeout(2500);
      const after = await view(page);
      const seen = await page.evaluate(
        (text) => {
          const box = document.querySelector(".main .feed")?.getBoundingClientRect();
          const row = [...document.querySelectorAll<HTMLElement>(".main .feed-list > [data-seq]")].findLast((r) => r.innerText.includes(text));
          const at = row?.getBoundingClientRect();
          return { drawn: !!row, shown: !!box && !!at && at.bottom <= box.bottom + 1 && at.top >= box.top };
        },
        mode === "busy" ? "work " : `${mode} ${BURST - 1}:`,
      );
      const last = seen.shown;
      const kept = before.below <= 2 && after.below <= 2 && last;
      const said = `${engine} ${mode}: ${before.below} → ${after.below}px below the view, the agent's last line ${last ? "on screen" : seen.drawn ? "off screen" : "not drawn"}`;
      console.log(`${kept ? "✓" : "✗"} ${said}`);
      if (!kept) {
        failures.push(said);
        await page.screenshot({ path: join(tmpdir(), `ui-doc-follow-${engine}-${mode}.png`) });
      }
      await page.evaluate(() => {
        const box = document.querySelector(".main .feed");
        if (box) box.scrollTop = box.scrollHeight;
      });
    }
  } finally {
    relay.kill();
    rmSync(data, { recursive: true, force: true });
  }
  return failures;
}

const failures: string[] = [];
for (const engine of ENGINES) {
  const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
  try {
    failures.push(...(await run(engine, browser)));
  } finally {
    await browser.close();
  }
}
if (failures.length) {
  console.error(`the view stopped following new messages: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("at the bottom, the view follows new messages, also right after you send");
