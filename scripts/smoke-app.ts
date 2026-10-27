import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = resolve(process.argv[2] ?? join(ROOT, "ui/dist"));
if (!existsSync(join(DIST, "index.html"))) throw new Error(`no index.html in ${DIST}: run bun run ui:build first`);

const data = mkdtempSync(join(tmpdir(), "kiwi-app-smoke-"));
const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };

const kiwi = (args: string[], watch?: (out: string) => void): Promise<string> => {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv });
  let out = "";
  const on = (d: Buffer) => ((out += d.toString("utf8")), watch?.(out));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))));
};

const said = async (as: string): Promise<{ seq: number; from: string; body?: string }[]> =>
  (await kiwi(["-c", "smoke", "--as", as, "log", "-n", "40", "--json"]))
    .split("\n")
    .flatMap((line) => (line.trim().startsWith("{") ? [JSON.parse(line) as { seq: number; from: string; body?: string }] : []));

const { relay, port } = await startLocalRelay(join(data, "relay"), DIST);
const BASE = `http://127.0.0.1:${port}/`;
const errors: string[] = [];
let at = "start";
const step = (line: string) => console.log(`ok  ${line}`);
const shot = async (name: string) => {
  if (process.env.SMOKE_SHOTS) await page.waitForTimeout(300).then(() => page.screenshot({ path: join(process.env.SMOKE_SHOTS ?? "", `${name}.png`) }));
};

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((e: unknown) => {
  relay.kill();
  rmSync(data, { recursive: true, force: true });
  throw e;
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push(`${at}: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${at}: console: ${m.text()}`);
});

const composer = page.getByRole("textbox", { name: "Message" });
const views = page.getByRole("navigation", { name: "Views" });
const send = async (text: string) => {
  await composer.fill(text);
  await composer.press("Enter");
  await page.locator("article").filter({ hasText: text }).first().waitFor({ timeout: 15000 });
  await page.locator("article.is-pending").filter({ hasText: text }).waitFor({ state: "detached", timeout: 15000 });
};

try {
  at = "first run";
  await page.goto(BASE);
  await page.getByRole("textbox", { name: "What should people call you?" }).fill("smoke");
  await page.getByRole("button", { name: "Continue" }).click();
  const addChannel = page.getByRole("button", { name: "New channel or join one" });
  await addChannel.waitFor({ timeout: 15000 });
  step(at);

  at = "create a channel";
  await addChannel.click();
  const dialog = page.getByRole("dialog", { name: "New channel" });
  await dialog.getByRole("textbox").fill("smoke");
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await composer.waitFor({ timeout: 30000 });
  await send("smoke test");
  step(at);

  at = "the invite carries the join code";
  await page.getByRole("button", { name: "invite", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Details" });
  const link = panel.locator("code").filter({ hasText: "kiwi://join/" }).first();
  await link.waitFor({ timeout: 15000 });
  const code = (await link.innerText()).trim().replace("kiwi://join/", "");
  if (!/^mc2-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+$/.test(code)) throw new Error(`the invite link carries no join code: ${code}`);
  await page.keyboard.press("Escape");
  step(at);

  at = "an agent asks to join and is let in after the codes match";
  let cliCode = "";
  const joining = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "bot"], (out) => {
    cliCode = /verification code ([\d-]+)/.exec(out)?.[1]?.replace(/\D/g, "") ?? cliCode;
  });
  const needsTab = views.getByRole("button", { name: /^Needs you/ });
  await needsTab.waitFor({ timeout: 30000 });
  await needsTab.click();
  const letIn = page.getByRole("button", { name: "It matches: let bot in" });
  await letIn.waitFor({ timeout: 30000 });
  const shown = async () => ((await page.locator(".needs-pin .sr").first().textContent()) ?? "").replace(/\D/g, "");
  for (let i = 0; i < 100 && !(/^\d{6}$/.test(await shown()) && cliCode); i++) await page.waitForTimeout(200);
  if ((await shown()) !== cliCode) throw new Error(`the code on screen (${await shown()}) isn't the one the agent sees (${cliCode || "none yet"})`);
  await shot("needs");
  await letIn.click();
  await joining;
  step(at);

  at = "the agent posts a message and a task";
  await views.getByRole("button", { name: /general/ }).click();
  await kiwi(["-c", "smoke", "--as", "bot", "send", "hello from bot"]);
  const ask = (await said("bot")).find((m) => m.body === "smoke test")?.seq;
  if (ask === undefined) throw new Error("the person's message isn't in the agent's log");
  await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot", "--ask", String(ask)]);
  await page.locator("article").filter({ hasText: "hello from bot" }).first().waitFor({ timeout: 30000 });
  await page.getByText("Smoke task").first().waitFor({ timeout: 30000 });
  await shot("general");
  await views.getByRole("button", { name: /^Tasks/ }).click();
  await page.getByRole("main").getByText("Smoke task").first().waitFor({ timeout: 15000 });
  await shot("tasks");
  await views.getByRole("button", { name: /general/ }).click();
  step(at);

  at = "an answer from the composer reaches the agent";
  await send("@bot got it, thanks");
  let heard = false;
  for (let i = 0; i < 50 && !heard; i++) {
    heard = (await said("bot")).some((m) => m.from === "smoke" && m.body === "@bot got it, thanks");
    if (!heard) await page.waitForTimeout(200);
  }
  if (!heard) throw new Error("the agent never got the answer");
  await shot("answered");
  step(at);
} catch (e) {
  errors.push(`${at}: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)}`);
} finally {
  if (errors.length) await page.screenshot({ path: join(tmpdir(), "kiwi-app-smoke-failure.png") }).catch(() => {});
  await browser.close();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}

if (errors.length) {
  console.error(`\nApp smoke failed:\n${errors.map((e) => `  ${e}`).join("\n")}\n(screenshot: ${join(tmpdir(), "kiwi-app-smoke-failure.png")})`);
  process.exit(1);
}
console.log("\nApp smoke passed");
