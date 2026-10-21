import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { Database } from "bun:sqlite";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { relayPort } from "./local-relay.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const OUT = resolve(args[0] ?? join(tmpdir(), "kiwi-timeline-shots"));
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-timeline-"));
const CLOCK = join(data, "clock");
const SECRET = "timeline-shots";
const REPO = "ojowwalker77/channels";
writeFileSync(CLOCK, "0");

const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const PRELOAD = join(ROOT, "scripts", "shots-clock.ts");
const env = {
  KIWI_MODEL: "claude-opus-5-5",
  ...process.env,
  BUN_OPTIONS: `--preload ${PRELOAD}`,
  KIWI_SHOTS_CLOCK: CLOCK,
  KIWI_HOME: join(cli, "home"),
  CLAUDE_CONFIG_DIR: join(cli, "no-claude"),
  PATH: `${join(cli, "bin")}:${process.env.PATH}`,
};
const running: ChildProcess[] = [];

function run(script: string, argv: string[], watch?: (out: string) => void): Promise<string> {
  const p = spawn("bun", [script, ...argv], { cwd: ROOT, env });
  running.push(p);
  let out = "";
  const on = (d: Buffer) => ((out += d), watch?.(out));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`${argv.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`)))));
}
const kiwi = (argv: string[], watch?: (out: string) => void) => run("src/cli/main.ts", argv, watch);
const as =
  (name: string) =>
  (...argv: string[]) =>
    kiwi(["-c", `c-${name}`, "--as", name, ...argv]);

let offset = 0;
async function minutesAgo(m: number) {
  offset = -Math.round(m * 60_000);
  writeFileSync(CLOCK, String(offset));
  await Bun.sleep(150);
}

const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", "0", "--data", join(data, "relay"), "--web", "web/dist", "--dev-sign-in"], {
  cwd: ROOT,
  env: { ...env, GITHUB_WEBHOOK_SECRET: SECRET },
  stdio: ["ignore", "pipe", "inherit"],
});
running.push(relay);
const port = await new Promise<number>((ok, fail) => {
  let out = "";
  relay.stdout!.on("data", (d: Buffer) => {
    out += d.toString("utf8");
    if (!out.includes("site:")) return;
    const p = relayPort(out);
    if (p !== null) ok(p);
    else fail(new Error(`no port: ${out}`));
  });
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)));
});
const BASE = `http://localhost:${port}/`;

let sha = 0;
async function github(event: string, payload: object) {
  const body = JSON.stringify({ repository: { full_name: REPO }, sender: { login: "ojowwalker77" }, ...payload });
  const sig = createHmac("sha256", SECRET).update(body).digest("hex");
  const res = await fetch(`${BASE}v1/github/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-github-event": event, "x-hub-signature-256": `sha256=${sig}` }, body });
  if (!res.ok) console.log(`webhook ${event}: ${res.status} ${await res.text()}`);
}
const pr = (number: number, branch: string, title: string, state: "open" | "closed", merged = false) =>
  github("pull_request", {
    action: merged ? "closed" : "opened",
    pull_request: {
      number,
      title,
      html_url: `https://github.com/${REPO}/pull/${number}`,
      state,
      merged,
      head: { ref: branch, sha: `${branch}-${++sha}`.padEnd(40, "0").slice(0, 40) },
      additions: 412,
      deletions: 88,
      changed_files: 9,
    },
  });
const check = (name: string, branch: string, head: string, conclusion?: string) =>
  github("check_run", {
    action: conclusion ? "completed" : "created",
    check_run: { name, status: conclusion ? "completed" : "in_progress", ...(conclusion ? { conclusion } : {}), head_sha: head, check_suite: { head_branch: branch } },
  });

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const shots: string[] = [];

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => localStorage.setItem("mc.appearance", t), theme);
  await page.reload();
  await page.waitForLoadState("networkidle");
}

try {
  let owner = await context.newPage();
  owner.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await owner.goto(BASE);
  await owner.getByRole("textbox", { name: "Your name" }).fill("Jow");
  await owner.getByRole("button", { name: "Continue" }).click();
  const newChannel = owner.getByRole("complementary").getByRole("button", { name: "New channel", exact: true });
  await newChannel.click();
  await owner.getByRole("dialog").getByRole("textbox").fill("channels-dev");
  await owner.getByRole("button", { name: "Create channel" }).click();
  await owner.waitForURL(/#mc2-/);
  const channel = owner.url();
  const code = decodeURIComponent(new URL(channel).hash.slice(1));

  const needs = owner.getByRole("region", { name: "Needs you" });
  const admit = async (name: string, model: string) => {
    console.log(`admitting ${name}`);
    const joining = kiwi(["join", code, `c-${name}`, "--as", name, "--model", model, "--relay", BASE]);
    const letIn = needs.getByRole("button", { name: "It matches: let in" });
    const showCode = needs.getByRole("button", { name: "Show code" });
    await letIn.or(showCode).first().waitFor({ timeout: 30000 });
    if (await showCode.count()) await showCode.click();
    await letIn.waitFor({ timeout: 30000 });
    const seat = needs.getByRole("checkbox", { name: /Let agents from .* in from now on/ });
    if (await seat.count()) await seat.uncheck();
    await letIn.click();
    await joining;
  };
  await admit("merry-llama", "claude-opus-5-5");
  const details = () => owner.getByRole("button", { name: /^Details:/ });
  await details().click();
  await owner.getByRole("button", { name: "More for merry-llama" }).click();
  await owner.getByRole("menuitem", { name: "Give a personality…" }).click();
  const leading = owner.getByRole("dialog", { name: /personality$/ });
  await leading.getByRole("radiogroup", { name: "Personality" }).getByText("Lead", { exact: true }).click();
  await leading.getByRole("button", { name: "Save" }).click();
  await leading.waitFor({ state: "detached" });
  await owner.getByRole("button", { name: "Close details" }).click();
  await admit("radiant-finch", "claude-opus-5-5");
  await admit("keen-pelican", "claude-opus-5-5");
  await admit("bright-robin", "gpt-6-sol");
  await admit("quiet-heron", "claude-sonnet-5-5");
  const offer = owner.getByRole("button", { name: "Save channels to a passkey" });
  if (await offer.isVisible({ timeout: 3000 }).catch(() => false)) await offer.click().catch(() => {});
  await owner.keyboard.press("Escape");

  await owner.route("**/github/repos", (r) => (r.request().method() === "PUT" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ repos: [REPO] }) }) : r.continue()));
  const people = new Database(join(data, "relay", "people.sqlite"));
  people.run("INSERT OR IGNORE INTO github_routes (repo, room) VALUES (?, ?)", [REPO.toLowerCase(), decodeJoinCode(code).roomId]);
  people.close();
  try {
    await details().click();
    await owner.getByRole("button", { name: /^Repos/ }).click();
    await owner.getByRole("textbox", { name: "Find a repo" }).fill(REPO);
    await owner.getByRole("button", { name: `Add ${REPO}` }).click();
    await owner.getByRole("button", { name: "Save", exact: true }).click();
    await owner.getByText("Repos saved").first().waitFor({ timeout: 15000 });
  } catch (e) {
    await owner.screenshot({ path: join(OUT, "debug-repos.png") });
    console.log(`repos not set, no CI on the shots: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }
  console.log("owner ready");
  await owner.close();

  const lead = as("merry-llama");
  const finch = as("radiant-finch");
  const pelican = as("keen-pelican");
  const robin = as("bright-robin");
  const heron = as("quiet-heron");
  const idOf = (out: string) => /T(\d+)/.exec(out)?.[1] ?? "0";
  const person = "jow";

  await minutesAgo(64);
  const flaky = idOf(await lead("task", "add", "Fix the flaky checkout test", "--owner", "radiant-finch"));
  await finch("task", "start", `T${flaky}`);
  await minutesAgo(60);
  const tree = idOf(await lead("task", "add", "Agent tree: who handed what to whom", "--owner", "radiant-finch", "--review", "quiet-heron"));
  await minutesAgo(59);
  const lanes = idOf(await lead("task", "add", "Agent lanes on a live timeline", "--owner", "keen-pelican", "--review", "quiet-heron"));
  await minutesAgo(58);
  const board = idOf(await lead("task", "add", "Delegate board: queue and busy-until", "--owner", "bright-robin"));
  await minutesAgo(57);
  await pelican("task", "start", `T${lanes}`);
  await minutesAgo(55);
  await robin("task", "start", `T${board}`);
  await minutesAgo(53);
  await finch("task", "done", `T${flaky}`, "PR #702 merged");
  await pr(702, `T${flaky}-flaky-checkout`, "Fix the flaky checkout test", "closed", true);
  await minutesAgo(52);
  await finch("task", "start", `T${tree}`);
  await minutesAgo(44);
  await finch("lock", "heavy", "--ttl", "30m", "--note", "web build");
  await minutesAgo(41);
  await pelican("lock", "heavy", "--ttl", "30m", "--note", "shoot-ui");
  await minutesAgo(40);
  const q = /#(\d+)/.exec(await pelican("ask", "--to", "merry-llama", "Do lease waits count as hand-offs, or only review rounds?"))?.[1];
  await minutesAgo(37);
  if (q) await lead("reply", q, "Only rounds and reassignments. Leases get their own rail.");
  await minutesAgo(35);
  await finch("unlock", "heavy");
  await minutesAgo(34);
  await finch("task", "review", `T${tree}`, "tree with rolled-up status");
  await minutesAgo(30);
  const looking = await context.newPage();
  try {
    await looking.clock.install({ time: Date.now() + offset });
    await looking.goto(channel);
    await looking.getByRole("complementary", { name: "Channel" }).getByRole("region", { name: "Conversations" }).getByRole("button", { name: /^# / }).first().click();
    await looking.getByRole("textbox", { name: "Message" }).fill("Back. Going through the board now.");
    await looking.keyboard.press("Enter");
    await looking.waitForTimeout(1500);
  } catch (e) {
    await looking.screenshot({ path: join(OUT, "debug-looked.png") }).catch(() => {});
    console.log(`no "you looked" message: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await looking.close();
  }
  await minutesAgo(26);
  await heron("task", "reject", `T${tree}`, "--round", "1", "Collapsing a branch hides its failed children; keep the red count on the parent.");
  await minutesAgo(25);
  await pelican("unlock", "heavy");
  await minutesAgo(22);
  await pr(731, `T${board}-delegate-board`, "Delegate board: queue and busy-until", "open");
  const head = `T${board}-delegate-board-${sha}`.padEnd(40, "0").slice(0, 40);
  await check("test / unit", `T${board}-delegate-board`, head);
  await check("test / flows-a", `T${board}-delegate-board`, head);
  await check("repo / static", `T${board}-delegate-board`, head);
  await minutesAgo(20);
  const release = idOf(await lead("task", "add", "Release kiwi 0.24.1", "--owner", "merry-llama"));
  await lead("task", "start", `T${release}`);
  await minutesAgo(17);
  await check("repo / static", `T${board}-delegate-board`, head, "success");
  await minutesAgo(15);
  await check("test / unit", `T${board}-delegate-board`, head, "success");
  await minutesAgo(14);
  await finch("task", "review", `T${tree}`, "red count stays on collapsed parents");
  await minutesAgo(12);
  await robin("ask", "--to", "radiant-finch", "Is the tree's rolled-up status reusable for the delegate board's lanes?");
  await minutesAgo(10);
  await lead("task", "done", `T${release}`, "0.24.1 is out");
  await minutesAgo(9);
  await check("test / flows-a", `T${board}-delegate-board`, head, "failure");
  await minutesAgo(8);
  const rename = idOf(await lead("task", "add", "Name the Agents tab's views", "--owner", "merry-llama", "--review", person));
  await lead("task", "start", `T${rename}`);
  await minutesAgo(6);
  await pelican(
    "ask-human",
    "--task",
    `T${lanes}`,
    "--option",
    "A: keep the seed",
    "--option",
    "B: a copy of real history",
    "Shoot the timeline on a copy of this channel's real history, or keep the seeded one?",
  );
  await minutesAgo(5);
  await lead("task", "review", `T${rename}`, "Timeline · By task · Columns");
  await minutesAgo(3);
  await run("scripts/seed-permission.ts", [
    "-c",
    "c-bright-robin",
    "--as",
    "bright-robin",
    "Bash",
    JSON.stringify({ command: "rm -rf web/dist && bun run web:build", description: "Rebuild the web bundle to check the size budget" }),
    "/Users/jow/www/channels",
  ]);
  await minutesAgo(0);
  writeFileSync(CLOCK, "0");
  await Bun.sleep(300);

  for (const name of ["merry-llama", "radiant-finch", "keen-pelican", "bright-robin", "quiet-heron"]) {
    let said = "";
    void kiwi(["-c", `c-${name}`, "--as", name, "listen"], (o) => void (said = o)).catch((e: unknown) => console.log(`listen ${name}: ${e instanceof Error ? e.message : e}`));
    await Bun.sleep(2500);
    console.log(`listen ${name}: ${said.trim().split("\n")[0] ?? ""}`);
  }

  await context.clock.setSystemTime(Date.now());
  owner = await context.newPage();
  owner.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await owner.goto(channel);
  await owner.waitForLoadState("networkidle");
  console.log("waiting for the owner's app to drain GitHub's queue");
  await owner.waitForTimeout(66_000);

  const toAgents = async () => {
    const side = owner.getByRole("complementary", { name: "Channel" });
    if (await side.isVisible().catch(() => false)) await side.getByRole("region", { name: "Agents" }).getByRole("button", { name: "Agents", exact: true }).click();
    else await owner.getByRole("navigation", { name: "Views of the channel" }).getByRole("button", { name: "Agents", exact: true }).click();
    await owner
      .getByRole("region", { name: /Agent timeline|Agent lanes/ })
      .first()
      .waitFor({ timeout: 15000 });
  };
  const mode = async (label: "Timeline" | "By task" | "Columns") => {
    await owner.getByRole("tablist", { name: "Agents view" }).getByRole("tab", { name: label }).click();
    await owner.waitForTimeout(400);
  };
  const shoot = async (name: string) => {
    await owner.waitForTimeout(500);
    const file = join(OUT, `${name}.png`);
    await owner.screenshot({ path: file });
    shots.push(file);
    console.log(`shot ${name}`);
  };

  await owner.screenshot({ path: join(OUT, "debug-reopened.png") });
  for (const theme of ["dark", "light"] as const) {
    await owner.setViewportSize({ width: 1440, height: 900 });
    await owner.goto(channel);
    await setTheme(owner, theme);
    await toAgents();
    await mode("Timeline");
    await shoot(`${theme}-wide-timeline`);
    await mode("By task");
    await shoot(`${theme}-wide-by-task`);
    await mode("Columns");
    await shoot(`${theme}-wide-columns`);
    await mode("Timeline");
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(channel);
    await owner.reload();
    await toAgents().catch(() => {});
    await shoot(`${theme}-narrow-timeline`);
  }
  console.log(`\n${shots.length} shots in ${OUT}`);
} finally {
  await browser.close().catch(() => {});
  for (const p of running) p.kill();
  const home = join(cli, "home");
  for (const line of Bun.spawnSync(["pgrep", "-f", "src/cli/main.ts daemon"]).stdout.toString().split("\n").filter(Boolean)) {
    const cwd = Bun.spawnSync(["lsof", "-a", "-p", line, "-d", "cwd", "-Fn"]).stdout.toString();
    if (cwd.includes(home)) process.kill(Number(line));
  }
}
