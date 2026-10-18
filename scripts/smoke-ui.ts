// Opens every menu, popover and dialog of the dashboard once, on the production
// build, and fails on any page error. Base UI throws on a misplaced part (a group
// label outside its group, say) only when that part renders, so typecheck can't
// see it: b085ae8 was one, and it blanked the page in prod.
//
// Beyond menus, it walks the flows only real state reaches: a passkey set up and
// unlocked on Chromium's virtual authenticator, the invite preview a join link
// shows someone who isn't in yet, a reload that paints the sent message from
// the sealed cache and asks the relay only for newer ones, a computer linked
// through its #link page by `kiwi setup`, that computer's agent asking to join
// and approved, and the task it adds opened in the Tasks panel.
//
//   bun run web:build && bun scripts/smoke-ui.ts
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Locator } from "playwright-core";

const ROOT = resolve(import.meta.dir, "..");
const PARTS = ["menus", "agents"] as const;
type Part = (typeof PARTS)[number];

const BASE_PORT = 20000 + Math.floor(Math.random() * 19990);

async function run(part: Part): Promise<string[]> {
  const PORT = BASE_PORT + PARTS.indexOf(part);
  const BASE = `http://localhost:${PORT}/`;
  const data = mkdtempSync(join(tmpdir(), "kiwi-smoke-"));

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
    const on = (d: Buffer) => ((out += d), watch?.(out));
    p.stdout.on("data", on);
    p.stderr.on("data", on);
    return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))));
  };

  const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", String(PORT), "--data", join(data, "relay"), "--web", "web/dist", "--dev-sign-in"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((ok, fail) => {
    let out = "";
    relay.stdout!.on("data", (d) => {
      out += d;
      if (out.includes("site: not served")) fail(new Error("web/dist is missing: run bun run web:build first"));
      else if (out.includes("site:")) ok();
    });
    relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)));
  });

  const log = (line: string) => console.log(`[${part}] ${line}`);
  const errors: string[] = [];
  let at = "start";
  const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((e) => {
    relay.kill();
    rmSync(data, { recursive: true, force: true });
    throw e;
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(`${at}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${at}: console: ${m.text()}`);
  });

  const popup = page.locator("[role=menu], [role=dialog], [role=alertdialog]").last();

  async function opens(name: string, open: () => Promise<void>) {
    at = name;
    await open();
    await popup.waitFor({ state: "visible", timeout: 5000 });
    const open_ = page.locator("[role=menu], [role=dialog], [role=alertdialog]");
    for (let i = 0; i < 3 && (await open_.count()) > 0; i++) {
      await page.keyboard.press("Escape");
      await open_
        .first()
        .waitFor({ state: "hidden", timeout: 2000 })
        .catch(() => {});
    }
    if ((await open_.count()) > 0) throw new Error(`${name} didn't close with Escape`);
    await page.waitForTimeout(150);
    log(`ok  ${name}`);
  }

  async function eachItem(name: string, trigger: Locator, only: (label: string) => boolean) {
    await trigger.click();
    await page.getByRole("menu").waitFor();
    const labels = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((s) => s.trim()).filter(only);
    await page.keyboard.press("Escape");
    for (const label of labels)
      await opens(`${name} → ${label}`, async () => {
        await trigger.click();
        await page.getByRole("menu").waitFor();
        await page.getByRole("menu").getByRole("menuitem", { name: label, exact: true }).click();
      });
  }

  const account = page.getByRole("complementary").locator('button[aria-haspopup="menu"]', { hasText: "smoke" });
  const newChannel = page.getByRole("complementary").getByRole("button", { name: "New channel", exact: true });
  const details = page.getByRole("button", { name: /^Details:/ });
  const panel = page.getByRole("complementary", { name: "Details" });
  const inDetails = async (fn: () => Promise<void>) => {
    if (!(await panel.isVisible())) await details.click();
    await panel.waitFor();
    await fn();
  };

  const firstRunAs = async (name: string) => {
    at = "first run";
    await page.goto(BASE);
    await page.getByRole("textbox").first().fill(name);
    await page.getByRole("button", { name: "Continue" }).click();
    await account.waitFor();
    log(`ok  ${at}`);
  };

  const darkAndLarger = async () => {
    at = "Settings → Dark, Larger";
    await account.click();
    await page.getByRole("menuitem", { name: "Settings…" }).click();
    const settings = page.getByRole("dialog").filter({ hasText: "Text size" });
    await settings.getByRole("radio", { name: "Dark" }).click();
    await settings.getByRole("radio", { name: "Larger" }).click();
    await settings.getByRole("button", { name: "Done" }).click();
    await settings.waitFor({ state: "hidden" });
    if ((await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"))) !== "1.22") throw new Error("the text size didn't apply");
    log(`ok  ${at}`);
  };

  const toTab = (name: "Tasks" | "Agents" | "Conversation") => page.getByRole("navigation", { name: "Views of the channel" }).getByRole("button", { name, exact: true }).click();

  const openInline = async (title: RegExp) => {
    await toTab("Tasks");
    const row = page.getByRole("button", { name: title }).first();
    await row.waitFor({ timeout: 15000 });
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    return page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: title }) })
      .first();
  };

  const createChannel = async () => {
    at = "create a channel";
    await newChannel.click();
    await page.getByRole("dialog").getByRole("textbox").fill("smoke");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.waitForURL(/#mc2-/);
    await page.getByRole("navigation", { name: "Views of the channel" }).getByRole("button", { name: "Tasks", exact: true }).and(page.locator("[aria-current=page]")).waitFor();
    await toTab("Conversation");
    await page.getByRole("textbox", { name: "Message" }).waitFor();
  };

  const send = async (text: string) => {
    const box = page.getByRole("textbox", { name: "Message" });
    await box.fill(text);
    await page.keyboard.press("Enter");
    await page.getByText(text, { exact: true }).first().waitFor();
    for (let i = 0; i < 100 && (await box.inputValue()) !== ""; i++) await page.waitForTimeout(100);
  };

  const menus = async () => {
    await firstRunAs("smoke");
    await opens("Account menu", () => account.click());
    await eachItem("Account menu", account, () => true);
    await darkAndLarger();
    await opens("Search palette", () => page.keyboard.press("ControlOrMeta+k"));
    await opens("Join with a code", async () => {
      await newChannel.click();
      await page.getByRole("dialog").getByRole("button", { name: "Have a code? Join" }).click();
    });

    await createChannel();
    at = "Add an agent card";
    const addAgent = page.getByRole("region", { name: "Add an agent" });
    await addAgent.waitFor();
    const card = await addAgent.innerText();
    if (!/sh -s -- join mc2-/.test(card)) throw new Error("the Add an agent card has no join command");
    if (!card.includes(`--relay ${new URL(BASE).origin}`)) throw new Error("the Add an agent command doesn't name this relay");
    log(`ok  ${at}`);

    at = "invite preview";
    const inviteCode = decodeURIComponent(new URL(page.url()).hash.slice(1));
    const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    guest.on("pageerror", (e) => errors.push(`${at}: ${e.message}`));
    try {
      await guest.goto(`${BASE}#${encodeURIComponent(inviteCode)}`);
      const guestContinue = guest.getByRole("button", { name: "Continue" });
      if (await guestContinue.isVisible({ timeout: 5000 }).catch(() => false)) {
        await guest.getByRole("textbox").first().fill("guest");
        await guestContinue.click();
      }
      await guest.getByRole("heading", { name: /invited you to a channel|You’re invited to a channel/ }).waitFor({ timeout: 10000 });
      log(`ok  ${at}`);
    } finally {
      await guest.close();
    }

    at = "Details";
    await inDetails(async () => {});
    log(`ok  ${at}`);
    await opens("Invite", () => inDetails(() => panel.getByRole("button", { name: "Invite", exact: true }).click()));
    await opens("Invite → A person", () =>
      inDetails(async () => {
        await panel.getByRole("button", { name: "Invite", exact: true }).click();
        await page
          .getByRole("dialog")
          .getByRole("tab", { name: "A person" })
          .or(page.getByRole("dialog").getByRole("button", { name: "A person" }))
          .first()
          .click();
      }),
    );
    for (const item of ["Charter", "Rename channel"]) await opens(`Details → ${item}`, () => inDetails(() => panel.getByRole("button", { name: new RegExp(`^${item}`) }).click()));
    at = "Details → Voice: the owner allows it for the channel";
    await inDetails(async () => {
      await panel.getByRole("button", { name: /^Voice/ }).click();
      await panel.getByText(/^Allowed: each person/).waitFor({ timeout: 15000 });
    });
    log(`ok  ${at}`);
    if (await panel.isVisible()) await panel.getByRole("button", { name: "Close details" }).click();

    at = "send and reply";
    await send("smoke test");
    await send("smoke, a second line");
    await page.locator("button[aria-label='Reply']").first().dispatchEvent("click");
    await page.getByText("Replying to").first().waitFor();
    await send("smoke, an inline reply");
    await page.getByRole("button", { name: /^Replying to .+: smoke test$/ }).waitFor();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "reply.png") });
    log("ok  a reply quotes what it answers, inline");
    await page.getByRole("button", { name: "1 Reply" }).click();
    await page.getByRole("button", { name: "Close thread" }).waitFor();
    await page.getByRole("button", { name: "Close thread" }).click();
    log("ok  Thread panel");
    await opens("Pause agents", () => inDetails(() => panel.getByRole("button", { name: /^Pause (all )?agents$/ }).click()));

    at = "history cache";
    await page.waitForFunction(
      async () => {
        const rows = await new Promise<unknown[]>((resolve) => {
          const req = indexedDB.open("mc.history");
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains("rows")) {
              db.close();
              resolve([]);
              return;
            }
            const all = db.transaction("rows", "readonly").objectStore("rows").getAll();
            all.onsuccess = () => {
              db.close();
              resolve(all.result as unknown[]);
            };
            all.onerror = () => {
              db.close();
              resolve([]);
            };
          };
          req.onerror = () => resolve([]);
        });
        return rows.length > 0 && !JSON.stringify(rows).includes("smoke test");
      },
      undefined,
      { timeout: 5000 },
    );
    log("ok  history cache sealed");

    at = "reload fetches only what is new";
    const sinceOnReload = new Promise<string>((resolve) => {
      const onWs = (ws: { url: () => string }) => {
        const since = new URL(ws.url()).searchParams.get("since");
        if (since == null) return;
        page.off("websocket", onWs);
        resolve(since);
      };
      page.on("websocket", onWs);
    });
    await page.reload();
    await toTab("Conversation");
    await page.getByText("smoke test", { exact: true }).first().waitFor();
    const since = await sinceOnReload;
    if (!(Number(since) > 0)) throw new Error(`reload streamed since ${since}; expected only newer seqs`);
    await account.waitFor();
    log(`ok  reload fetches only what is new (since ${since})`);
  };

  const agents = async () => {
    await firstRunAs("smoke");
    await darkAndLarger();
    await createChannel();
    await send("smoke test");

    const sidebar = page.getByRole("complementary", { name: "Channel" });
    const addAgent = page.getByRole("region", { name: "Add an agent" });
    const channel = page.url();
    const code = new URL(channel).hash.slice(1);
    at = "an agent asks";
    const joining = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "bot", "--role", "tester"]);
    const needs = page.getByRole("region", { name: "Needs you" });
    const needsOpen = async () => {
      await needs.getByRole("heading", { name: /^Needs you/ }).waitFor({ timeout: 30000 });
    };
    const letIn = needs.getByRole("button", { name: "It matches: let in" });
    const showCode = needs.getByRole("button", { name: "Show code" });
    await needsOpen();
    await letIn.or(showCode).first().waitFor({ timeout: 30000 });
    if (await showCode.count()) await showCode.click();
    await letIn.waitFor({ timeout: 30000 });
    await needs.getByText("claude-sonnet-5-5").first().waitFor({ timeout: 5000 });
    if (process.env.SMOKE_SHOTS) {
      await needs.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "needs-you.png") });
    }
    log(`ok  ${at} (its model shows)`);
    await opens("Needs you → Choose what it can do…", () => needs.getByRole("button", { name: "Choose what it can do…" }).click());
    at = "approve";
    await needsOpen();
    await letIn.click();
    await joining;
    await addAgent.waitFor({ state: "hidden", timeout: 15000 });
    log(`ok  ${at}`);

    at = "a second agent";
    await page.goto(channel);
    await toTab("Conversation");
    await page.getByText("smoke test", { exact: true }).first().waitFor();
    const helper = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "helper"]);
    await needsOpen();
    await letIn.or(showCode).first().waitFor({ timeout: 30000 });
    if (await showCode.count()) await showCode.click();
    await letIn.click({ timeout: 30000 });
    await helper;
    log(`ok  ${at}`);

    at = "read receipt";
    await send("smoke, read me");
    for (const as of ["bot", "helper"]) await kiwi(["-c", "smoke", "--as", as, "listen", "--now"]);
    await page.getByText(/^Read( by|\s\d)/).waitFor({ timeout: 15000 });
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "read.png") });
    log(`ok  ${at}`);

    at = "read receipt on a reply";
    await page.locator("button[aria-label='Reply']").last().dispatchEvent("click");
    await send("smoke, read my reply");
    for (const as of ["bot", "helper"]) await kiwi(["-c", "smoke", "--as", as, "listen", "--now"]);
    await page.getByText(/^Read( by|\s\d|$)/).waitFor({ timeout: 15000 });
    log(`ok  ${at}`);

    const smokeTask = /T\d+/.exec(await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot"]))?.[0] ?? "T0";
    at = "Agents: a lane per agent, with what's next on it";
    await toTab("Agents");
    await page.getByRole("region", { name: "Agent lanes" }).getByText("Smoke task").first().waitFor({ timeout: 15000 });
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "lanes.png") });
    log(`ok  ${at}`);
    at = "Task in the Tasks panel";
    const tasksPanel = page.getByRole("complementary", { name: "Tasks" });
    const inline = await openInline(/Smoke task/);
    await inline.getByRole("textbox", { name: "Message" }).fill("smoke, inline");
    await page.keyboard.press("Enter");
    await inline.getByText("smoke, inline", { exact: true }).first().waitFor({ timeout: 15000 });
    log("ok  a task opens inline in Tasks, and its reply box talks in it");
    await inline.getByRole("button", { name: "Details", exact: true }).click();
    await tasksPanel
      .getByRole("region", { name: /^Task T\d+/ })
      .getByRole("button", { name: /^Activity/ })
      .click();
    await tasksPanel.getByRole("textbox", { name: /^Comment on T\d+/ }).waitFor();
    await tasksPanel.getByRole("textbox", { name: "Message" }).fill("smoke in the task");
    await page.keyboard.press("Enter");
    await tasksPanel.getByText("smoke in the task", { exact: true }).first().waitFor();
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    await tasksPanel.waitFor({ state: "detached" });
    await toTab("Conversation");
    await page
      .waitForFunction(
        (text) => {
          const said = [...document.querySelectorAll("body *")].filter((e) => e.textContent?.trim() === text && ![...e.children].some((c) => c.textContent?.trim() === text));
          return said.length > 0 && said.every((e) => /^Open T\d+, Smoke task/.test(e.closest("button")?.getAttribute("aria-label") ?? ""));
        },
        "smoke in the task",
        { timeout: 15000 },
      )
      .catch(() => {
        throw new Error("a message in a task's conversation showed in main outside its task card");
      });
    log(`ok  ${at}`);

    at = "a slash in the composer lists the commands, and one runs instead of being sent";
    const typed = page.getByRole("textbox", { name: "Message" });
    await typed.fill("/");
    await page
      .getByRole("listbox", { name: "Commands" })
      .getByRole("option", { name: /\/tasks/ })
      .waitFor({ timeout: 15000 });
    await typed.fill("/tasks");
    await typed.press("Enter");
    await tasksPanel.waitFor({ timeout: 15000 });
    if ((await typed.inputValue()) !== "") throw new Error("a command stayed in the composer after it ran");
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    await tasksPanel.waitFor({ state: "detached" });
    if (await page.getByText("/tasks", { exact: true }).count()) throw new Error("a command was sent as a message");
    log(`ok  ${at}`);

    at = "the task's card in the conversation shows its last line, and a click opens the Tasks panel";
    const taskCard = page.getByRole("main").getByRole("button", { name: new RegExp(`^Open ${smokeTask}, Smoke task`) });
    await taskCard.waitFor({ timeout: 15000 });
    if ((await taskCard.count()) !== 1) throw new Error(`${smokeTask} has more than one card in the main column`);
    await taskCard.getByText("smoke in the task", { exact: true }).waitFor();
    await taskCard.click();
    await tasksPanel.getByRole("region", { name: new RegExp(`^Task ${smokeTask}`) }).waitFor({ timeout: 15000 });
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    await tasksPanel.waitFor({ state: "detached" });
    log(`ok  ${at}`);

    at = "ask-human: the question sits in the composer with its options, and the task waits on a person until one is picked";
    await kiwi(["-c", "smoke", "--as", "bot", "ask-human", "--task", smokeTask, "--option", "A: ship it", "--option", "B: wait a day", "Ship the smoke build now?"]);
    const awaiting = page.getByText("Needs a decision");
    await toTab("Tasks");
    await awaiting.first().waitFor({ timeout: 15000 });
    await toTab("Conversation");
    const question = page.getByRole("region", { name: "Question" });
    await question.getByText("Ship the smoke build now?").waitFor({ timeout: 15000 });
    if (await needs.count()) throw new Error("a decision for the person showed in Needs you as well as in the composer");
    await question.getByRole("button", { name: "Something else" }).waitFor();
    await question.getByRole("list", { name: "Options" }).getByRole("button", { name: "B: wait a day" }).click();
    await question.waitFor({ state: "detached", timeout: 15000 });
    await toTab("Tasks");
    await awaiting.first().waitFor({ state: "detached", timeout: 15000 });
    await toTab("Conversation");
    log(`ok  ${at}`);

    at = "an answered ask says who chose what, on the ask itself";
    await kiwi(["-c", "smoke", "--as", "bot", "ask-human", "--option", "A: red", "--option", "B: blue", "Which colour for the smoke?"]);
    await question.getByText("Which colour for the smoke?").waitFor({ timeout: 15000 });
    await page.getByRole("main").getByText("Waiting on you").first().waitFor({ timeout: 15000 });
    await question.getByRole("list", { name: "Options" }).getByRole("button", { name: "B: blue" }).click();
    await page
      .getByRole("main")
      .getByText(/chose this/)
      .first()
      .waitFor({ timeout: 15000 });
    log(`ok  ${at}`);

    at = "Take over, then cancel, a task waiting on an agent's review";
    const added = /added (T\d+)/.exec(await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke review", "--owner", "bot", "--review", "helper"]))?.[1];
    if (!added) throw new Error("kiwi task add printed no task id");
    await kiwi(["-c", "smoke", "--as", "bot", "task", "review", added]);
    await (await openInline(/Smoke review/)).getByRole("button", { name: "Details", exact: true }).click();
    const reviewed = tasksPanel.getByRole("region", { name: `Task ${added}` });
    await reviewed.getByRole("button", { name: "Send back" }).waitFor({ timeout: 15000 });
    if (await reviewed.getByRole("button", { name: "Approve" }).count()) throw new Error("Approve showed for a review waiting on an agent");
    await reviewed.getByRole("button", { name: "Change reviewer…" }).click();
    const picking = page.getByRole("dialog", { name: `Who reviews ${added}?` });
    const shots = process.env.SMOKE_SHOTS;
    if (shots) await page.waitForTimeout(400).then(() => page.screenshot({ path: join(shots, "change-reviewer.png") }));
    await picking.getByRole("button", { name: /\(you\)/ }).click();
    await picking.waitFor({ state: "detached" });
    await reviewed.getByRole("button", { name: "Approve" }).waitFor({ timeout: 15000 });
    await reviewed.getByRole("button", { name: "Cancel task…" }).click();
    const cancelling = page.getByRole("dialog", { name: `Cancel ${added}?` });
    await cancelling.getByRole("textbox", { name: "Why it’s cancelled" }).fill("smoke: stale");
    if (shots) await page.waitForTimeout(400).then(() => page.screenshot({ path: join(shots, "cancel-task.png") }));
    await cancelling.getByRole("button", { name: "Cancel task" }).click();
    await cancelling.waitFor({ state: "detached" });
    await reviewed.getByRole("button", { name: "Cancel task…" }).waitFor({ state: "detached", timeout: 15000 });
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    log(`ok  ${at}`);

    for (const item of ["Change nickname…", "Set role…", "Remove from channel…"])
      await opens(`Details → bot → ${item}`, () =>
        inDetails(async () => {
          await panel.getByRole("button", { name: "More for bot" }).click();
          await page.getByRole("menuitem", { name: item }).click();
        }),
      );

    at = "Make bot the lead";
    await inDetails(async () => {
      await panel.getByRole("button", { name: "More for bot" }).click();
      await page.getByRole("menuitem", { name: "Make lead" }).click();
    });
    await page.getByText("bot is the lead").first().waitFor({ timeout: 15000 });
    await panel.getByRole("img", { name: "The lead" }).waitFor({ timeout: 15000 });
    log("ok  the lead wears a robot avatar");

    await panel.getByRole("button", { name: "More for bot" }).click();
    await page.getByRole("menuitem", { name: "Message privately" }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("smoke, privately");
    await page.keyboard.press("Enter");
    await page.getByText("smoke, privately", { exact: true }).first().waitFor({ timeout: 15000 });
    const general = sidebar.getByRole("region", { name: "Conversations" }).getByRole("button", { name: /^# general/ });
    await general.click();
    await general.and(page.locator("[aria-current=page]")).waitFor();
    log(`ok  ${at} and a direct conversation`);

    at = "Tasks panel";
    await sidebar.getByRole("region", { name: "Agents" }).waitFor();
    await sidebar
      .getByRole("navigation", { name: "Views" })
      .getByRole("button", { name: /^Everything/ })
      .click();
    await (await openInline(/Smoke task/)).getByRole("button", { name: "Details", exact: true }).click();
    await tasksPanel.getByRole("button", { name: "All tasks" }).click();
    await tasksPanel.getByRole("textbox", { name: "Filter tasks" }).waitFor();
    await page.keyboard.press("Escape");
    await tasksPanel.waitFor({ state: "detached" });
    await toTab("Conversation");
    await page.getByRole("textbox", { name: "Message" }).waitFor();
    log(`ok  ${at}`);

    const triggers = await page.locator("[aria-haspopup]:visible").all();
    for (const [i, t] of triggers.entries()) {
      const label = (await t.getAttribute("aria-label")) || (await t.innerText()).trim().split("\n").pop()!.slice(0, 30) || `#${i}`;
      if (!(await t.isEnabled())) continue;
      await opens(`sweep: ${label}`, () => t.click());
    }
  };

  try {
    if (part === "menus") await menus();
    else await agents();
  } catch (e) {
    errors.push(`${at}: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)}`);
  } finally {
    if (errors.length) await page.screenshot({ path: join(tmpdir(), `kiwi-smoke-failure-${part}.png`) }).catch(() => {});
    await browser.close();
    relay.kill();
    rmSync(data, { recursive: true, force: true });
  }
  return errors;
}

const runs = await Promise.all(PARTS.map((part) => run(part).catch((e: unknown) => [`${part}: ${e instanceof Error ? e.message : String(e)}`])));
const errors = runs.flat();
if (errors.length) {
  console.error(`\nUI smoke failed:\n${errors.map((e) => `  ${e}`).join("\n")}\n(screenshots, if any: ${join(tmpdir(), "kiwi-smoke-failure-*.png")})`);
  process.exit(1);
}
console.log("\nUI smoke passed");
