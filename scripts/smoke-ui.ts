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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Locator } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";

const ROOT = resolve(import.meta.dir, "..");
const PARTS = ["menus", "agents"] as const;
type Part = (typeof PARTS)[number];

async function run(part: Part): Promise<string[]> {
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

  const { relay, port } = await startLocalRelay(join(data, "relay"), "web/dist");
  const BASE = `http://localhost:${port}/`;

  const log = (line: string) => console.log(`[${part}] ${line}`);
  const errors: string[] = [];
  let at = "start";
  const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((e) => {
    relay.kill();
    rmSync(data, { recursive: true, force: true });
    throw e;
  });
  const video = process.env.SMOKE_VIDEO && part === "agents" ? { recordVideo: { dir: process.env.SMOKE_VIDEO, size: { width: 1280, height: 800 } } } : {};
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ...video });
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

  const shell = page.getByRole("complementary", { name: "Channels" });
  const account = shell.locator('button[aria-haspopup="menu"]', { hasText: "smoke" });
  const newChannel = shell.getByRole("button", { name: "New channel", exact: true });
  const conversations = shell.getByRole("region", { name: "Conversations" });
  const details = page.getByRole("button", { name: /^Details:/ });
  const panel = page.getByRole("complementary", { name: "Details" });
  const inDetails = async (fn: () => Promise<void>) => {
    if (!(await panel.isVisible()) && !(await details.isVisible())) await toTab("Conversation");
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
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = page.getByRole("region", { name: "Settings" });
    await settings.getByRole("radio", { name: "Dark" }).click();
    await settings.getByRole("radio", { name: "Larger" }).click();
    if (process.env.SMOKE_SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "settings.png") });
    }
    await page.getByRole("button", { name: "Close settings" }).click();
    await settings.waitFor({ state: "detached" });
    if ((await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"))) !== "1.22") throw new Error("the text size didn't apply");
    log(`ok  ${at}`);
  };

  const macLights = async () => {
    at = "Mac: the traffic lights sit on the sidebar's top row, clear of its controls and of the page";
    await page.evaluate(() => (document.documentElement.dataset.shell = "mac"));
    const room = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--lights-w")));
    const start = await newChannel.evaluate((el) => {
      const row = el.parentElement!;
      return row.getBoundingClientRect().left + parseFloat(getComputedStyle(row).paddingLeft);
    });
    const left = await page
      .locator("main")
      .first()
      .evaluate((el) => el.getBoundingClientRect().left);
    if (!(room > 0) || start < room) throw new Error(`on a Mac the sidebar's top row starts ${Math.round(start)}px in, under the traffic lights (they need ${room}px)`);
    if (left < room) throw new Error(`on a Mac the page starts ${Math.round(left)}px in, under the traffic lights (they need ${room}px)`);
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "mac-lights.png"), clip: { x: 0, y: 0, width: 400, height: 160 } });
    await page.evaluate(() => delete document.documentElement.dataset.shell);
    log(`ok  ${at}`);
  };

  const personalities = async () => {
    at = "Settings → Personalities: a preset duplicated is yours";
    await account.click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = page.getByRole("region", { name: "Settings" });
    await settings.getByRole("button", { name: /^Personalities/ }).click();
    const editor = page.getByRole("region", { name: "Personalities" });
    await editor.getByRole("button", { name: "Duplicate" }).click();
    await page.getByRole("list", { name: "Yours" }).getByText("Builder copy").waitFor({ timeout: 10000 });
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "personalities.png") });
    await page.getByRole("button", { name: "Back to Settings" }).click();
    await page.getByRole("button", { name: "Close settings" }).click();
    await settings.waitFor({ state: "detached" });
    log(`ok  ${at}`);
  };

  /** The header's tabs on a phone; on a wide screen the toolbar's Tasks and Agents, which toggle, and the conversation in the sidebar. */
  const toTab = async (name: "Tasks" | "Agents" | "Conversation") => {
    const tabs = page.getByRole("navigation", { name: "Views of the channel" });
    if (await tabs.isVisible()) return tabs.getByRole("button", { name, exact: true }).click();
    if (await panel.isVisible()) {
      await panel.getByRole("button", { name: "Close details" }).click();
      await panel.waitFor({ state: "detached" });
    }
    const tasks = page.getByRole("button", { name: /^Tasks(,|$)/ });
    const agents = page.getByRole("button", { name: "Agents", exact: true });
    if (name === "Tasks") return (await tasks.getAttribute("aria-pressed")) === "true" ? undefined : tasks.click();
    if (name === "Agents") return (await agents.getAttribute("aria-pressed")) === "true" ? undefined : agents.click();
    if (await conversations.isVisible()) return conversations.getByRole("list").getByRole("button").first().click();
    for (const on of [tasks, agents]) if ((await on.getAttribute("aria-pressed")) === "true") await on.click();
  };

  const openFromBoard = async (title: RegExp) => {
    await toTab("Tasks");
    const row = page.getByRole("button", { name: title }).first();
    await row.waitFor({ timeout: 15000 });
    await row.click();
    const panel = page.getByRole("complementary", { name: "Tasks" });
    await panel.getByRole("region", { name: /^Task T\d+/ }).waitFor({ timeout: 15000 });
    return panel;
  };

  const createChannel = async () => {
    at = "create a channel";
    await newChannel.click();
    await page.getByRole("dialog").getByRole("textbox").fill("smoke");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.waitForURL(/#mc2-/);
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
    await eachItem("Account menu", account, (label) => label !== "Settings");
    await darkAndLarger();
    await macLights();
    await personalities();
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

    at = "sidebar: the open channel's row is current with its conversations under it, and ⌘\\ hides the sidebar and leaves the toolbar to show it again";
    await shell.getByRole("navigation", { name: "Your channels" }).locator('button[aria-current="page"]', { hasText: "smoke" }).waitFor();
    await conversations.waitFor();
    await page.keyboard.press("ControlOrMeta+Backslash");
    await shell.waitFor({ state: "hidden" });
    const showSidebar = page.getByRole("button", { name: /^Show the sidebar/ });
    await showSidebar.waitFor();
    await page.reload();
    await showSidebar.waitFor();
    if (await shell.isVisible()) throw new Error("the hidden sidebar came back after a reload");
    await showSidebar.click();
    await conversations.waitFor();
    await toTab("Conversation");
    await page.getByRole("textbox", { name: "Message" }).waitFor();
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
    at = "Invite → A person, in the details panel";
    await inDetails(() => panel.getByRole("button", { name: "Invite", exact: true }).click());
    await panel.getByRole("heading", { name: "Invite to this channel" }).waitFor();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "invite.png") });
    await panel.getByRole("tab", { name: "A person" }).click();
    await panel.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: "Invite", exact: true }).waitFor();
    log(`ok  ${at}`);
    at = "Details → Repos: a repo typed by name joins the channel";
    await panel.getByRole("button", { name: /^Repos/ }).click();
    await panel.getByRole("heading", { name: "Repos" }).waitFor();
    await panel.getByRole("textbox", { name: "Find a repo" }).fill("octo/kiwi");
    await panel.getByRole("textbox", { name: "Find a repo" }).press("Enter");
    await panel.getByRole("list", { name: "This channel's repos" }).getByText("octo/kiwi").waitFor();
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Repos saved").waitFor();
    await panel.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: /^Repos.*octo\/kiwi/ }).waitFor();
    log(`ok  ${at}`);
    at = "Details → Rooms: the owner makes #mobile and renames it, a taken name is refused before it's sent, and the room shows in the sidebar";
    await panel.getByRole("button", { name: /^Rooms/ }).click();
    await panel.getByRole("heading", { name: "Rooms" }).waitFor();
    const roomName = panel.getByRole("textbox", { name: "New room’s name" });
    await roomName.fill("#mobile");
    await panel.getByRole("button", { name: "New room", exact: true }).click();
    await page.getByText("Made #mobile").first().waitFor();
    const roomList = panel.getByRole("list", { name: "This channel's rooms" });
    await roomList.getByText("#mobile", { exact: true }).waitFor();
    await roomName.fill("Mobile");
    await panel.getByText("A room is already called #Mobile").waitFor();
    if (await panel.getByRole("button", { name: "New room", exact: true }).isEnabled()) throw new Error("a room name already taken could still be sent");
    await roomName.fill("");
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "rooms.png") });
    await panel.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: /^Rooms.*#mobile/ }).waitFor();
    await conversations.getByRole("button", { name: /# mobile/ }).waitFor();
    await panel.getByRole("button", { name: /^Rooms/ }).click();
    await panel.getByRole("button", { name: "Rename #mobile" }).click();
    await panel.getByRole("textbox", { name: "New name for #mobile" }).fill("ios");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Renamed to #ios").first().waitFor();
    await panel.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: /^Rooms.*#ios/ }).waitFor();
    await conversations.getByRole("button", { name: /# ios/ }).waitFor();
    log(`ok  ${at}`);
    at = "a room is its own conversation: what's posted in #ios shows there and not in #general";
    await panel.getByRole("button", { name: "Close details" }).click();
    await panel.waitFor({ state: "detached" });
    const roomRow = (text: string) => page.locator("[id^='m']").filter({ hasText: text });
    await conversations.getByRole("button", { name: /# ios/ }).click();
    await page.getByRole("textbox", { name: "Message" }).and(page.getByPlaceholder("Message #ios")).waitFor();
    await send("smoke, in #ios");
    await roomRow("smoke, in #ios").first().waitFor();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "room-ios.png") });
    await conversations.getByRole("button", { name: /# general/ }).click();
    await page.getByPlaceholder("Message #general").waitFor();
    await page.waitForTimeout(300);
    if (await roomRow("smoke, in #ios").count()) throw new Error("a message posted in #ios shows in #general");
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "room-general.png") });
    await conversations.getByRole("button", { name: /# ios/ }).click();
    await roomRow("smoke, in #ios").first().waitFor();
    await conversations.getByRole("button", { name: /# general/ }).click();
    await page.getByPlaceholder("Message #general").waitFor();
    await inDetails(async () => {});
    log(`ok  ${at}`);
    at = "phone: the header opens Details, and Invite is reachable from it";
    await panel.getByRole("button", { name: "Close details" }).click();
    await panel.waitFor({ state: "detached" });
    await page.setViewportSize({ width: 390, height: 844 });
    const tabsEnd = await page.getByRole("navigation", { name: "Views of the channel" }).evaluate((nav) => nav.getBoundingClientRect().right);
    if (tabsEnd > 390) throw new Error(`the channel header's tabs run off a phone's edge (to ${Math.round(tabsEnd)}px)`);
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "phone.png") });
    await details.click();
    await panel.getByRole("button", { name: "Invite", exact: true }).click();
    await panel.getByRole("heading", { name: "Invite to this channel" }).waitFor();
    await panel.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: "Close details" }).click();
    await details.waitFor();
    await page.setViewportSize({ width: 1280, height: 800 });
    log(`ok  ${at}`);
    for (const item of ["Charter", "Name"]) await opens(`Details → ${item}`, () => inDetails(() => panel.getByRole("button", { name: new RegExp(`^${item}`) }).click()));
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
    at = "a reply right after two sends keeps its quote: an earlier send's late answer doesn't clear the reply, and a reply to a message still sending waits for its seq";
    await page.getByRole("complementary", { name: "Thread" }).waitFor({ state: "detached" });
    for (let i = 1; i <= 3; i++) {
      await send(`ping ${i}`);
      await send(`pong ${i}`);
      await page
        .locator("[id^='m']")
        .filter({ hasText: `ping ${i}` })
        .last()
        .locator("button[aria-label='Reply']")
        .dispatchEvent("click");
      await page.getByPlaceholder(/^Reply to /).waitFor();
      await send(`answer ${i}`);
      await page
        .locator("[id^='m']:not([id^='m-'])")
        .filter({ hasText: `answer ${i}` })
        .getByRole("button", { name: new RegExp(`^Replying to .+: ping ${i}$`) })
        .waitFor({ timeout: 15000 });
    }
    log(`ok  ${at}`);
    at = "Details → Download, any time: a transcript to read (each message's number, date, time and sender) and the signed log, named with the date and time";
    await inDetails(async () => {});
    const downloads = panel.getByRole("region", { name: "Download" });
    const [md] = await Promise.all([page.waitForEvent("download"), downloads.getByRole("button", { name: "Transcript (.md)" }).click()]);
    if (!/-transcript-\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(md.suggestedFilename())) throw new Error(`the transcript was saved as ${md.suggestedFilename()}`);
    if (!/\*\*#\d+ · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · smoke\*\*\n\n> smoke test\n/.test(readFileSync(await md.path(), "utf8")))
      throw new Error("the transcript lacks “smoke test”, quoted, under its number, date, time and sender");
    const [jsonl] = await Promise.all([page.waitForEvent("download"), downloads.getByRole("button", { name: "Signed log (.jsonl)" }).click()]);
    if (!/-log-\d{4}-\d{2}-\d{2}-\d{4}\.jsonl$/.test(jsonl.suggestedFilename())) throw new Error(`the log was saved as ${jsonl.suggestedFilename()}`);
    const signed: unknown[] = readFileSync(await jsonl.path(), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (!signed.every((m) => typeof m === "object" && m !== null && "sig" in m)) throw new Error("a line of the downloaded log has no signature");
    log(`ok  ${at}`);
    at = "Details → Close channel…: the log downloads first, every message signed, and Cancel keeps the channel";
    await inDetails(() => panel.getByRole("button", { name: /^Close channel/ }).click());
    const closing = page.getByRole("dialog", { name: "Close this channel for everyone?" });
    await closing.waitFor();
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "close-channel.png") });
    const [saved] = await Promise.all([page.waitForEvent("download"), closing.getByRole("button", { name: "Download log" }).click()]);
    const kept: unknown[] = readFileSync(await saved.path(), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    if (!saved.suggestedFilename().endsWith(".jsonl")) throw new Error(`the log was saved as ${saved.suggestedFilename()}`);
    if (!kept.every((m) => typeof m === "object" && m !== null && "sig" in m && "pk" in m)) throw new Error("a line of the log has no signature");
    if (!kept.some((m) => typeof m === "object" && m !== null && "body" in m && m.body === "smoke, an inline reply")) throw new Error("the log is missing a message just sent");
    await closing.getByRole("button", { name: "Cancel" }).click();
    await closing.waitFor({ state: "hidden" });
    log(`ok  ${at}`);
    if (await panel.isVisible()) await panel.getByRole("button", { name: "Close details" }).click();
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

    at = "the app opened with no channel in its address reopens the one that was open";
    await page.goto(new URL("/", BASE).href);
    await page.getByText("smoke test", { exact: true }).first().waitFor({ timeout: 15000 });
    if (await page.getByRole("heading", { name: "Nothing open" }).count()) throw new Error("the app showed Nothing open instead of the channel that was open");
    log(`ok  ${at}`);
  };

  const agents = async () => {
    await firstRunAs("smoke");
    await darkAndLarger();
    await createChannel();
    await send("smoke test");

    const addAgent = page.getByRole("region", { name: "Add an agent" });
    const channel = page.url();
    const code = new URL(channel).hash.slice(1);
    at = "an agent asks";
    const joining = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "bot"]);
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
    const joinRow = needs.getByRole("button", { name: /wants to join/ });
    const expand = async () => {
      if ((await joinRow.first().getAttribute("aria-expanded")) !== "true") await joinRow.first().click();
    };
    await expand();
    await needs.getByText("claude-sonnet-5-5").first().waitFor({ timeout: 5000 });
    if (process.env.SMOKE_SHOTS) {
      await needs.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "needs-you.png") });
    }
    log(`ok  ${at} (its model shows)`);
    at = "details: who wants to join is let in from Needs you, the one place";
    await inDetails(() => panel.getByRole("button", { name: "Review", exact: true }).click());
    await panel.waitFor({ state: "detached" });
    await letIn.waitFor({ timeout: 15000 });
    for (const gone of ["Copy invite link", "Review and approve"]) if (await page.getByRole("button", { name: gone }).count()) throw new Error(`details still offers "${gone}"`);
    log(`ok  ${at}`);
    await expand();
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
    await letIn.waitFor({ timeout: 30000 });
    await expand();
    await needs.getByRole("button", { name: "Choose what it can do…" }).click();
    const letting = page.getByRole("dialog", { name: /^Let helper in\?/ });
    await letting.getByRole("radiogroup", { name: "Personality" }).getByText("Reviewer", { exact: true }).click();
    await letting.getByRole("button", { name: "Let in as Reviewer" }).click();
    await helper;
    if (!(await kiwi(["-c", "smoke", "--as", "helper", "status"])).includes("helper (you) — Reviewer (Reviewer)")) throw new Error("the personality picked at Let in isn't on the agent's seat");
    log(`ok  ${at}, let in as Reviewer`);

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

    const said = (await kiwi(["-c", "smoke", "--as", "bot", "log", "-n", "20", "--json"])).split("\n").flatMap((line) => (line.trim() ? [JSON.parse(line) as { seq: number; body?: string }] : []));
    const ask = said.find((m) => m.body === "smoke, read my reply")?.seq;
    if (ask === undefined) throw new Error("the person's message isn't in kiwi log");
    const smokeTask = /T\d+/.exec(await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot", "--ask", String(ask)]))?.[0] ?? "T0";
    at = "Agents: a lane per agent, with what's next on it";
    await toTab("Agents");
    await page.getByRole("region", { name: "Agent lanes" }).getByText("Smoke task").first().waitFor({ timeout: 15000 });
    if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "lanes.png") });
    log(`ok  ${at}`);
    at = "Task in the Tasks panel";
    const tasksPanel = await openFromBoard(/Smoke task/);
    if (await tasksPanel.getByRole("button", { name: "All tasks" }).count()) throw new Error("the Tasks panel offers a second task list");
    log("ok  a board row opens its task in the Tasks panel, with no second list behind it");
    const squeezedRows = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('li > [role="button"]')].flatMap((row) => {
          const label = row.getAttribute("aria-label") ?? "";
          if (!/^T\d+, /.test(label)) return [];
          const text = row.children[1];
          return text && text.getBoundingClientRect().width >= 120 && text.scrollWidth <= text.clientWidth + 1 ? [] : [label];
        }),
      );
    for (const width of [1280, 1180]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(200);
      const squeezed = await squeezedRows();
      if (squeezed.length) throw new Error(`at ${width}px with a task open, the board's rows lose their title or spill out of it: ${squeezed.join("; ")}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    log("ok  with a task open beside it, each board row keeps its title and nothing spills out of it, at 1280 and 1180px");
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
      .getByRole("main")
      .getByRole("button", { name: /^Open T\d+, Smoke task/ })
      .first()
      .waitFor({ timeout: 15000 });
    if (await page.getByText("smoke in the task", { exact: true }).count()) throw new Error("a message in a task's conversation showed in main, outside its task");
    log(`ok  ${at}: main shows the task as one line, and what was said in it stays in the task`);

    at = "a reload shows no empty state before the channel's history is in";
    await page.addInitScript(() => {
      if (sessionStorage.getItem("smoke.emptyStates") !== "watch") return;
      sessionStorage.removeItem("smoke.emptyStates");
      const w = window as unknown as { __emptyStates: string[] };
      const seen = new Set<string>();
      w.__emptyStates = [];
      const look = () => {
        if (document.querySelector('section[aria-label="Add an agent"]')) seen.add("Add an agent");
        for (const p of document.querySelectorAll("p")) if (p.textContent === "No tasks yet" || p.textContent === "No messages yet") seen.add(p.textContent);
        w.__emptyStates = [...seen];
      };
      const watch = new MutationObserver(look);
      watch.observe(document, { childList: true, subtree: true, characterData: true });
      setTimeout(() => watch.disconnect(), 5000);
    });
    await page.evaluate(() => sessionStorage.setItem("smoke.emptyStates", "watch"));
    await page.reload();
    await page.getByText("Smoke task").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    const flashed = await page.evaluate(() => (window as unknown as { __emptyStates?: string[] }).__emptyStates ?? null);
    if (flashed === null) throw new Error("the watch for empty states didn't run on the reload");
    if (flashed.length) throw new Error(`a reload of a channel with agents and a task showed ${flashed.join(", ")} before its history`);
    log(`ok  ${at}`);
    await toTab("Conversation");

    at = "a slash in the composer lists the commands, and one runs instead of being sent";
    const typed = page.getByRole("textbox", { name: "Message" });
    await typed.fill("/");
    await page
      .getByRole("listbox", { name: "Commands" })
      .getByRole("option", { name: /\/tasks/ })
      .waitFor({ timeout: 15000 });
    await typed.fill("/tasks");
    await typed.press("Enter");
    await page
      .locator('nav[aria-label="Views of the channel"]:visible button[aria-current="page"]:text-is("Tasks"), nav[aria-label="Views"]:visible button[aria-current="page"]')
      .first()
      .waitFor({ timeout: 15000 });
    if (await tasksPanel.count()) throw new Error("/tasks opened a task list in the side panel instead of the Tasks tab");
    await toTab("Conversation");
    if ((await typed.inputValue()) !== "") throw new Error("a command stayed in the composer after it ran");
    if (await page.getByText("/tasks", { exact: true }).count()) throw new Error("a command was sent as a message");
    log(`ok  ${at}`);

    at = "the task's line in the conversation opens the Tasks panel";
    const taskCard = page.getByRole("main").getByRole("button", { name: new RegExp(`^Open ${smokeTask}, Smoke task`) });
    await taskCard.waitFor({ timeout: 15000 });
    if ((await taskCard.count()) !== 1) throw new Error(`${smokeTask} has more than one line in the main column`);
    await taskCard.click();
    await tasksPanel.getByRole("region", { name: new RegExp(`^Task ${smokeTask}`) }).waitFor({ timeout: 15000 });
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    await tasksPanel.waitFor({ state: "detached" });
    log(`ok  ${at}`);

    at =
      "ask-human: the question sits in the composer with its options, is one row of Needs you, Tasks' Needs you shows it as one row with its options, and the task waits on a person until one is picked";
    await kiwi(["-c", "smoke", "--as", "bot", "ask-human", "--task", smokeTask, "--option", "A: ship it", "--option", "B: wait a day", "Ship the smoke build now?"]);
    const awaiting = page.getByRole("button", { name: new RegExp(`^${smokeTask}, Smoke task`) }).getByText("Needs you", { exact: true });
    await toTab("Tasks");
    await awaiting.first().waitFor({ timeout: 15000 });
    await needs.getByText("Ship the smoke build now?").waitFor({ timeout: 15000 });
    await needs.getByRole("button", { name: "A: ship it" }).waitFor();
    await needs.getByRole("button", { name: "Something else" }).click();
    await needs.getByRole("textbox", { name: "Answer" }).waitFor();
    await toTab("Conversation");
    const question = page.getByRole("region", { name: "Question" });
    await question.getByText("Ship the smoke build now?").waitFor({ timeout: 15000 });
    await needs.getByText("Ship the smoke build now?").waitFor({ timeout: 15000 });
    await question.getByRole("button", { name: "Something else" }).waitFor();
    await question.getByRole("list", { name: "Options" }).getByRole("button", { name: "B: wait a day" }).click();
    await question.waitFor({ state: "detached", timeout: 15000 });
    await toTab("Tasks");
    await awaiting.first().waitFor({ state: "detached", timeout: 15000 });
    await toTab("Conversation");
    log(`ok  ${at}`);

    at = "an ask in the conversation is only a pointer to the composer while it waits, and once answered says who chose what";
    await kiwi(["-c", "smoke", "--as", "bot", "ask-human", "--holds", smokeTask, "--kind", "taste", "--option", "A: red", "--option", "B: blue", "Which colour for the smoke?"]);
    await question.getByText("Which colour for the smoke?").waitFor({ timeout: 15000 });
    await page.getByRole("main").getByText("Answer it below").first().waitFor({ timeout: 15000 });
    if (await page.getByRole("main").getByText("Waiting on you").count()) throw new Error("the question in the composer was also shown whole in the feed");
    await question.getByRole("list", { name: "Options" }).getByRole("button", { name: "B: blue" }).click();
    await page
      .getByRole("main")
      .getByText(/chose this/)
      .first()
      .waitFor({ timeout: 15000 });
    log(`ok  ${at}`);

    at = "Take over, then cancel, a task waiting on an agent's review";
    const added = /added (T\d+)/.exec(await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke review", "--owner", "bot", "--review", "helper", "--from", smokeTask]))?.[1];
    if (!added) throw new Error("kiwi task add printed no task id");
    await kiwi(["-c", "smoke", "--as", "bot", "task", "review", added]);
    await openFromBoard(/Smoke review/);
    const reviewed = tasksPanel.getByRole("region", { name: `Task ${added}` });
    await reviewed.getByRole("button", { name: "Send back" }).waitFor({ timeout: 15000 });
    if (await reviewed.getByRole("button", { name: "Approve" }).count()) throw new Error("Approve showed for a review waiting on an agent");
    await reviewed.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Change reviewer…" }).click();
    const picking = page.getByRole("dialog", { name: `Who reviews ${added}?` });
    const shots = process.env.SMOKE_SHOTS;
    if (shots) await page.waitForTimeout(400).then(() => page.screenshot({ path: join(shots, "change-reviewer.png") }));
    await picking.getByRole("button", { name: /\(you\)/ }).click();
    await picking.waitFor({ state: "detached" });
    await reviewed.getByRole("button", { name: "Approve" }).waitFor({ timeout: 15000 });
    await reviewed.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Cancel task…" }).click();
    const cancelling = page.getByRole("dialog", { name: `Cancel ${added}?` });
    await cancelling.getByRole("textbox", { name: "Why it’s cancelled" }).fill("smoke: stale");
    if (shots) await page.waitForTimeout(400).then(() => page.screenshot({ path: join(shots, "cancel-task.png") }));
    await cancelling.getByRole("button", { name: "Cancel task" }).click();
    await cancelling.waitFor({ state: "detached" });
    await reviewed.getByRole("button", { name: "More", exact: true }).waitFor({ state: "detached", timeout: 15000 });
    await tasksPanel.getByRole("button", { name: "Close tasks" }).click();
    log(`ok  ${at}`);

    for (const item of ["Change nickname…", "Remove from channel…"])
      await opens(`Details → bot → ${item}`, () =>
        inDetails(async () => {
          await panel.getByRole("button", { name: "More for bot" }).click();
          await page.getByRole("menuitem", { name: item }).click();
        }),
      );

    at = "Make bot the lead";
    await inDetails(async () => {
      await panel.getByRole("button", { name: "More for bot" }).click();
      await page.getByRole("menuitem", { name: "Give a personality…" }).click();
    });
    const leading = page.getByRole("dialog", { name: /personality$/ });
    await leading.getByRole("radiogroup", { name: "Personality" }).getByText("Lead", { exact: true }).click();
    await leading.getByRole("button", { name: "Save" }).click();
    await leading.waitFor({ state: "detached" });
    await page.getByText("bot is Lead now").first().waitFor({ timeout: 15000 });
    log("ok  bot is the lead");

    at = "Pick the channel's icon";
    await inDetails(async () => {
      await panel.getByRole("button", { name: "Change the channel's icon" }).click();
      await panel.getByRole("radio", { name: "teal robot" }).click();
    });
    await page.getByText("Icon changed").first().waitFor({ timeout: 15000 });
    log("ok  the owner picks the channel's robot head");

    await panel.getByRole("button", { name: "More for bot" }).click();
    await page.getByRole("menuitem", { name: "Message privately" }).click();
    await page.getByRole("textbox", { name: "Message" }).fill("smoke, privately");
    await page.keyboard.press("Enter");
    await page.getByText("smoke, privately", { exact: true }).first().waitFor({ timeout: 15000 });
    const general = conversations.getByRole("button", { name: /^# general/ });
    await general.click();
    await general.and(page.locator("[aria-current=page]")).waitFor();
    log(`ok  ${at} and a direct conversation`);

    at = "change helper's personality from its menu";
    await inDetails(async () => {
      await panel.getByRole("button", { name: "More for helper" }).click();
      await page.getByRole("menuitem", { name: "Personality: Reviewer…" }).click();
    });
    const changing = page.getByRole("dialog", { name: /personality$/ });
    await changing.getByRole("radiogroup", { name: "Personality" }).getByText("Builder", { exact: true }).click();
    await changing.getByRole("button", { name: "Save" }).click();
    await changing.waitFor({ state: "detached" });
    for (let i = 0; i < 50 && !(await kiwi(["-c", "smoke", "--as", "helper", "status"])).includes("helper (you) — Builder (Builder)"); i++) await page.waitForTimeout(200);
    if (!(await kiwi(["-c", "smoke", "--as", "helper", "status"])).includes("helper (you) — Builder (Builder)")) throw new Error("the personality changed from the menu isn't on the agent's seat");
    log(`ok  ${at}`);

    at = "Tasks panel";
    await openFromBoard(/Smoke task/);
    await page.keyboard.press("Escape");
    await tasksPanel.waitFor({ state: "detached" });
    await toTab("Conversation");
    await page.getByRole("textbox", { name: "Message" }).waitFor();
    log(`ok  ${at}`);

    at = "an invite pins a personality, and Let in lets the agent in as it";
    await inDetails(() => panel.getByRole("button", { name: "Invite", exact: true }).click());
    const inviting = panel;
    await inviting.getByRole("radiogroup", { name: "Personality" }).getByText("Bug hunter", { exact: true }).click();
    const withPin = inviting.locator("code", { hasText: "--persona" });
    await withPin.waitFor({ timeout: 15000 });
    const token = /--persona (\S+)/.exec((await withPin.textContent()) ?? "")?.[1];
    if (!token) throw new Error("the invite command carries no --persona token");
    const spill = await withPin.evaluate((c) => Math.max(...[...c.children].map((s) => s.getBoundingClientRect().right)) - c.getBoundingClientRect().right);
    if (spill > 1) throw new Error(`the invite command runs ${Math.round(spill)}px past its box's right edge`);
    await inviting.getByRole("button", { name: "Back to details" }).click();
    await panel.getByRole("button", { name: "Close details" }).click();
    const hunter = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "hunter", "--persona", token]);
    await needsOpen();
    await needs.getByText(/pinned as Bug hunter/).waitFor({ timeout: 30000 });
    await letIn.or(showCode).first().waitFor({ timeout: 30000 });
    if (await showCode.count()) await showCode.click();
    await needs.getByRole("button", { name: "It matches: let in as Bug hunter" }).click({ timeout: 30000 });
    await hunter;
    if (!(await kiwi(["-c", "smoke", "--as", "hunter", "status"])).includes("hunter (you) — Bug hunter (Bug hunter)")) throw new Error("the pinned personality isn't on the agent's seat");
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
