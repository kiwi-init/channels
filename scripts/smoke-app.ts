import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";
import { harnessDist } from "./ui-harness.ts";
import { approveSpec } from "./perf-ui.ts";

const ROOT = resolve(import.meta.dir, "..");
const DIST = harnessDist(process.argv[2]);

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
const ICON_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAbElEQVR4nA3JQQEAMAgDMaRUClIqpVKQwvNkIGXLN1WFii5cpJhiiyuqhEQLi4gRK04/GjXduEkzzTbXP4xMG5uYMWvOP4JCB4eECRsuPwYNPXjIMMMONz8WLb14yTLLLrc/Dh19+Mgxxx53PLzkagFHPAwGAAAAAElFTkSuQmCC";
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
  await page.getByRole("textbox", { name: "Your name" }).fill("smoke");
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
  const link = panel.locator("code").filter({ hasText: "#mc2-" }).first();
  await link.waitFor({ timeout: 15000 });
  const code = (await link.innerText()).trim().replace(/^.*#/, "");
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

  at = "a note the agent sets shows in channel settings, and the owner clears it";
  await kiwi(["-c", "smoke", "--as", "bot", "note", "smoke-url", "https://example.test"]);
  await page.getByRole("button", { name: /: channel settings$/ }).click();
  const notes = page.getByRole("complementary", { name: "Details" }).locator(".cpanel-facts");
  await notes.getByText("smoke-url").waitFor({ timeout: 15000 });
  await notes.getByRole("button", { name: "Clear smoke-url" }).click();
  await notes.getByRole("button", { name: "Clear", exact: true }).click();
  let cleared = false;
  for (let i = 0; i < 50 && !cleared; i++) {
    cleared = await kiwi(["-c", "smoke", "--as", "bot", "get", "smoke-url"]).then(
      () => false,
      (e: unknown) => String(e).includes("no fact"),
    );
    if (!cleared) await page.waitForTimeout(200);
  }
  if (!cleared) throw new Error("the agent still has the note after the owner cleared it");
  await page.keyboard.press("Escape");
  step(at);

  at = "the agent writes a spec, no task goes in before the person approves it, then the agent posts a message and a task";
  await views.getByRole("button", { name: /general/ }).click();
  await kiwi(["-c", "smoke", "--as", "bot", "send", "hello from bot"]);
  const ask = (await said("bot")).find((m) => m.body === "smoke test")?.seq;
  if (ask === undefined) throw new Error("the person's message isn't in the agent's log");
  await kiwi(["-c", "smoke", "--as", "bot", "spec", "write", String(ask), "# Smoke\n\n## Done when\n- [ ] the smoke passes"]);
  const early = await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Too early", "--ask", String(ask)]).then(
    () => "",
    (e: unknown) => String(e),
  );
  if (!early.includes("isn't approved yet")) throw new Error(`a task went in before its spec was approved: ${early || "no refusal"}`);
  await approveSpec(page);
  const added = await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot", "--ask", String(ask)]);
  const task = /\bT(\d+)\b/.exec(added)?.[1];
  if (task === undefined) throw new Error(`kiwi task add printed no task id: ${added.trim()}`);
  await page.locator("article").filter({ hasText: "hello from bot" }).first().waitFor({ timeout: 30000 });
  await page.getByText("Smoke task").first().waitFor({ timeout: 30000 });
  await shot("general");
  await views.getByRole("button", { name: /^Specs/ }).click();
  await page.getByRole("main").getByText("Smoke task").first().waitFor({ timeout: 15000 });
  await shot("tasks");
  await views.getByRole("button", { name: /general/ }).click();
  step(at);

  at = "the owner turns on Write to GitHub and sets a branch prefix";
  await page.getByRole("button", { name: /: channel settings$/ }).click();
  const settings = page.getByRole("complementary", { name: "Details" });
  await settings.getByLabel("Add a repo").fill("kiwi-init/smoke");
  await settings.getByLabel("Add a repo").press("Enter");
  const github = settings.locator(".cpanel-github");
  await github.waitFor({ timeout: 15000 });
  await github.getByLabel("Write to GitHub").click();
  await github.getByRole("button", { name: "Set" }).click();
  await github.getByRole("textbox", { name: "Branch prefix" }).fill("T");
  await github.getByRole("textbox", { name: "Branch prefix" }).press("Enter");
  const wanted = ["turned on Write to GitHub", "branch prefix: T"];
  let got: string[] = [];
  for (let i = 0; i < 50 && wanted.some((w) => !got.includes(w)); i++) {
    got = (await said("bot")).flatMap((m) => (m.from === "smoke" && m.body ? [m.body] : []));
    if (wanted.some((w) => !got.includes(w))) await page.waitForTimeout(200);
  }
  for (const w of wanted) if (!got.includes(w)) throw new Error(`the agent never saw "${w}"`);
  await page.keyboard.press("Escape");
  await views.getByRole("button", { name: /general/ }).click();
  step(at);

  at = "search lists tasks and messages, jumps to a message, and clears";
  const openSearch = () => page.getByRole("button", { name: /^Search this channel/ }).click();
  const search = page.getByRole("combobox", { name: "Search this channel" });
  const results = page.getByRole("listbox", { name: "Search results" });
  await openSearch();
  await search.fill("smok tas");
  await results.getByRole("option", { name: /Smoke task/ }).click();
  await panel.getByText("Smoke task").first().waitFor({ timeout: 15000 });
  if (await results.count()) throw new Error("picking a task left the results open");
  await page.keyboard.press("Escape");
  await search.fill("hel bot");
  const hello = results.getByRole("option").filter({ hasText: "hello from bot" }).first();
  await hello.waitFor({ timeout: 15000 });
  if ((await hello.locator("mark").allTextContents()).join("|") !== "bot|hel|bot") throw new Error("a result doesn't mark the words that matched");
  if ((await results.getByRole("option").first().getAttribute("aria-selected")) !== "true") throw new Error("the first result isn't the active one");
  await search.press("Enter");
  await results.waitFor({ state: "detached" });
  await page.waitForFunction(() => [...(CSS.highlights.get("search-hit") ?? [])].some((r) => r.toString() === "hel"), undefined, { timeout: 15000 });
  await shot("search-jump");
  await page.keyboard.press("ControlOrMeta+f");
  if (!(await search.evaluate((el) => el === document.activeElement))) throw new Error("the search shortcut did not focus the open search field");
  await views.getByRole("button", { name: /^Specs/ }).click();
  await views.getByRole("button", { name: /general/ }).click();
  await page.locator("article").filter({ hasText: "hello from bot" }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  if (await page.evaluate(() => CSS.highlights.has("search-hit"))) throw new Error("coming back to the room replayed the old search jump");
  await search.fill("hello");
  await results.getByRole("option").first().waitFor({ timeout: 15000 });
  if (await page.evaluate(() => CSS.highlights.has("search-hit"))) throw new Error("a new search kept the old message's highlight");
  await page.getByRole("button", { name: "Clear search" }).click();
  await search.fill("zz-nothing");
  if (await results.getByRole("option").count()) throw new Error("typing after Clear search showed the previous query's results");
  await page.getByText("Nothing matches “zz-nothing”.").waitFor();
  await page.getByRole("button", { name: "Clear search" }).click();
  if ((await search.inputValue()) !== "") throw new Error("Clear search left text in the field");
  await results.waitFor({ state: "detached" });
  if (!(await search.evaluate((el) => el === document.activeElement))) throw new Error("Clear search took the focus out of the field");
  await search.press("Escape");
  await search.waitFor({ state: "detached" });
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

  at = "an agent proposes a compact, the owner approves it, and the history folds";
  const proposed = await kiwi(["-c", "smoke", "--as", "bot", "compact", `Smoke summary: T${task} is open, asked in #${ask}.`]);
  if (!proposed.includes("proposed #")) throw new Error(`kiwi compact did not propose: ${proposed.trim()}`);
  const card = page.getByRole("region", { name: "Proposed compact" });
  await card.waitFor({ timeout: 30000 });
  await shot("compact-proposed");
  await card.getByRole("button", { name: "Approve and compact" }).click();
  const fold = page.getByRole("region", { name: "Compacted history" });
  await fold.waitFor({ timeout: 30000 });
  await card.waitFor({ state: "detached", timeout: 15000 });
  await page.locator("article").filter({ hasText: "hello from bot" }).waitFor({ state: "detached", timeout: 15000 });
  await shot("compacted");
  await fold.getByRole("button", { name: "Show earlier messages" }).click();
  await page.locator("article").filter({ hasText: "hello from bot" }).first().waitFor({ timeout: 15000 });
  await fold.getByRole("button", { name: "Hide earlier messages" }).click();
  let compacted = false;
  for (let i = 0; i < 50 && !compacted; i++) {
    compacted = (await said("bot")).some((m) => m.from === "smoke" && m.body?.startsWith("compacted the history through #") === true);
    if (!compacted) await page.waitForTimeout(200);
  }
  if (!compacted) throw new Error("the agent never saw the compact");
  step(at);

  at = "the owner renames a room and gives the channel an image";
  await page.getByRole("button", { name: /: channel settings$/ }).click();
  const details = page.getByRole("complementary", { name: "Details" });
  await details.getByRole("button", { name: "Rename" }).nth(1).click();
  const roomName = details.getByRole("textbox", { name: /^Name of #/ });
  await roomName.fill("lobby");
  await roomName.press("Enter");
  await page.getByText("lobby", { exact: true }).first().waitFor({ timeout: 15000 });
  const png = join(data, "icon.png");
  writeFileSync(png, Buffer.from(ICON_PNG, "base64"));
  await details.locator('input[type="file"]').setInputFiles(png);
  await page.locator(".rail img").first().waitFor({ timeout: 15000 });
  await shot("channel-settings");
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
