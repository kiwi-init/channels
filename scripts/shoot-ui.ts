// Screenshots of every screen of the dashboard, for design work: each surface in dark and light,
// wide and narrow, as the owner, as someone invited, and signed out. Seeds a realistic channel
// first (a lead and an agent working a task, messages, a thread, a task's conversation, a
// direct one, notes, a pending join request), the same way scripts/smoke-ui.ts walks the flows.
//
//   bun run web:build && bun scripts/shoot-ui.ts [outdir] [--only channel,task-thread,…] [--wide] [--theme dark|light]
//
// Shots are taken at 2x (Retina), as most people see the dashboard. --only keeps the screens whose
// name contains one of the words (and skips the signed-out ones unless named), --wide skips the phone
// size, --theme keeps one theme: for a quick look at a few screens while working on them.
// A screen that can't be reached is saved as skipped-<name>.png and fails the run. CI's
// `build / shots` runs it --wide --theme dark and uploads the shots as the ui-shots artifact.
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright-core";
import { startLocalRelay } from "./local-relay.ts";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : (args.splice(i, 2)[1] ?? "");
};
const only = flag("--only")?.split(",").filter(Boolean);
const themeOnly = flag("--theme");
const wideOnly = args.includes("--wide") ? (args.splice(args.indexOf("--wide"), 1), true) : false;
const OUT = resolve(args[0] ?? join(tmpdir(), "kiwi-shots"));
mkdirSync(OUT, { recursive: true });
const data = mkdtempSync(join(tmpdir(), "kiwi-shots-"));

const cli = join(data, "cli");
mkdirSync(join(cli, "bin"), { recursive: true });
mkdirSync(join(data, "relay"));
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n");
  chmodSync(join(cli, "bin", opener), 0o755);
}
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` };
const running: ChildProcess[] = [];
function kiwi(args: string[], watch?: (out: string) => void, script = "src/cli/main.ts"): Promise<string> {
  const p = spawn("bun", [script, ...args], { cwd: ROOT, env: cliEnv });
  running.push(p);
  let out = "";
  const on = (d: Buffer) => ((out += d), watch?.(out));
  p.stdout.on("data", on);
  p.stderr.on("data", on);
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`)))));
}
let pendingOut = "";
const bot = (...args: string[]) => kiwi(["-c", "kiwi", "--as", "atlas", ...args]);
const win = (...args: string[]) => kiwi(["-c", "kiwi-w", "--as", "win", ...args]);

const { relay, port } = await startLocalRelay(join(data, "relay"), "web/dist");
const BASE = `http://localhost:${port}/`;

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined });
const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 390, height: 844 };
const shots: string[] = [];
const skipped: string[] = [];
/** Retina, as the owner sees it: the crispness of type and edges is half of what the shots are for. */
const page = (viewport: { width: number; height: number }) => browser.newPage({ viewport, deviceScaleFactor: 2 });
const wanted = (name: string) => !only || only.some((w) => name.includes(w));

async function firstRunAs(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Your name" }).fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(name, "i") })
    .first()
    .waitFor();
}

async function passkey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  } as never);
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => localStorage.setItem("mc.appearance", t), theme);
  await page.reload();
  await page.waitForLoadState("networkidle");
}

function macWindow(on: boolean): void {
  document.querySelector("[data-shots-lights]")?.remove();
  if (!on) return void delete document.documentElement.dataset.shell;
  document.documentElement.dataset.shell = "mac";
  const lights = document.createElement("div");
  lights.dataset.shotsLights = "";
  lights.style.cssText = "position:fixed;left:20px;top:20px;z-index:100;display:flex;gap:8px;pointer-events:none";
  for (const color of ["#ff5f57", "#febc2e", "#28c840"]) {
    const light = document.createElement("span");
    light.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color}`;
    lights.append(light);
  }
  document.body.append(lights);
}

function dragCaught(): string[] {
  const boxes = [...document.querySelectorAll("*")].flatMap((el) => {
    const region = getComputedStyle(el).getPropertyValue("app-region");
    const r = el.getBoundingClientRect();
    return (region === "drag" || region === "no-drag") && r.width && r.height ? [{ r, drag: region === "drag" }] : [];
  });
  const dragged = (x: number, y: number) => boxes.reduce((on, { r, drag }) => (x >= r.left && x < r.right && y >= r.top && y < r.bottom ? drag : on), false);
  return [...document.querySelectorAll('[role="dialog"] :is(button, input, [role="menuitem"])')].flatMap((el) => {
    const r = el.getBoundingClientRect();
    return r.width && dragged(r.left + r.width / 2, r.top + r.height / 2) ? [el.getAttribute("aria-label") ?? el.textContent ?? el.tagName] : [];
  });
}

/** One named screen: get there, wait for it to settle, shoot it, put things back. */
async function shoot(page: Page, tag: string, name: string, open?: () => Promise<void>, close: () => Promise<void> = async () => void (await page.keyboard.press("Escape"))) {
  if (!wanted(name)) return;
  try {
    if (open) await open();
    await page.waitForTimeout(350);
    const file = join(OUT, `${tag}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    console.log(`shot ${tag}-${name}`);
  } catch (e) {
    skipped.push(`${tag}-${name}`);
    await page.screenshot({ path: join(OUT, `skipped-${tag}-${name}.png`) }).catch(() => {});
    console.log(`skip ${tag}-${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  } finally {
    await close().catch(() => {});
    await page.waitForTimeout(150);
  }
}

try {
  // ---------- seed: the owner, a channel, an agent on a linked computer, a pending request ----------
  const owner = await page(WIDE);
  owner.on("pageerror", (e) => console.log(`page error: ${e.message}`));
  await owner.goto(BASE);
  await firstRunAs(owner, "Jonatas");
  await passkey(owner);

  // New is the list's first row.
  const newChannel = owner.getByRole("complementary").getByRole("button", { name: "New channel", exact: true });
  await newChannel.click();
  await owner.getByRole("dialog").getByRole("textbox").fill("kiwi");
  await owner.getByRole("button", { name: "Create channel" }).click();
  await owner.waitForURL(/#mc2-/);
  const channel = owner.url();
  const code = decodeURIComponent(new URL(channel).hash.slice(1));
  /** The header's tabs on a phone; on a wide screen the sidebar is the navigation. */
  const toTab = async (name: "Tasks" | "Agents" | "Conversation") => {
    const tabs = owner.getByRole("navigation", { name: "Views of the channel" });
    if (await tabs.isVisible()) return tabs.getByRole("button", { name, exact: true }).click();
    const side = owner.getByRole("complementary", { name: "Channel" });
    if (name === "Tasks") return side.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Tasks", exact: true }).click();
    if (name === "Agents") return side.getByRole("region", { name: "Agents" }).getByRole("button", { name: "Agents", exact: true }).click();
    return side.getByRole("region", { name: "Conversations" }).getByRole("button", { name: /^# / }).first().click();
  };

  const needs = owner.getByRole("region", { name: "Needs you" });
  /** An agent asks in; the owner compares its code under Needs you and lets it in. */
  const admit = async (args: string[]) => {
    console.log(`admitting ${args.join(" ")}`);
    const joining = kiwi(["join", code, ...args, "--relay", BASE], (o) => void (pendingOut = o));
    const letIn = needs.getByRole("button", { name: "It matches: let in" });
    const showCode = needs.getByRole("button", { name: "Show code" });
    await letIn.or(showCode).first().waitFor({ timeout: 30000 });
    if (await showCode.count()) await showCode.click();
    await letIn.waitFor({ timeout: 30000 });
    // Each agent asks, so each one is there to shoot: don't seat the computer.
    const seat = needs.getByRole("checkbox", { name: /Let agents from .* in from now on/ });
    if (await seat.count()) await seat.uncheck();
    await letIn.click();
    await joining;
  };
  await admit(["kiwi", "--as", "atlas", "--model", "claude-opus-5-5"]);
  const details = () => owner.getByRole("button", { name: /^Details:/ });
  await details().click();
  await owner.getByRole("button", { name: "More for atlas" }).click();
  await owner.getByRole("menuitem", { name: "Give a personality…" }).click();
  const leading = owner.getByRole("dialog", { name: /personality$/ });
  await leading.getByRole("radiogroup", { name: "Personality" }).getByText("Lead", { exact: true }).click();
  await leading.getByRole("button", { name: "Save" }).click();
  await leading.waitFor({ state: "detached" });
  await owner.getByText("atlas is Lead now").first().waitFor({ timeout: 15000 });
  await owner.getByRole("button", { name: "Close details" }).click();
  await admit(["kiwi-w", "--as", "win", "--model", "gpt-5-codex"]);
  // The passkey offer waits for an agent's first card; save the channels to it, so the list stays quiet.
  const offer = owner.getByRole("button", { name: "Save channels to a passkey" });
  if (await offer.isVisible({ timeout: 5000 }).catch(() => false)) {
    await offer.click();
    const saving = owner.getByRole("dialog").filter({ hasText: "Save your recovery code" });
    await saving.waitFor();
    await saving.getByRole("checkbox").check();
    await saving.getByRole("button", { name: "Done" }).click();
    await saving.waitFor({ state: "hidden" });
  }

  // The main conversation: the person and the lead. A question, a thread, a long message with code.
  await toTab("Conversation");
  const composer = () => owner.getByRole("textbox", { name: "Message" });
  await composer().fill("Morning. The relay deploy is done; can someone check the Effect router numbers?");
  await owner.keyboard.press("Enter");
  await owner.waitForTimeout(400);
  await bot("send", "On it, @jonatas. I’ll have @win run the steady load first, then the cold runs.");
  await bot(
    "send",
    "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`, one prebuilt program per request:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```",
  );
  await bot("ask", "--to", "jonatas", "Ship it as 0.8.12, or wait for the web?");
  // Work: each task has its own conversation, where the agents working it talk.
  const firstTask = /T(\d+)/.exec(await bot("task", "add", "Write fewer rows per message", "--owner", "win"));
  await bot("task", "add", "Polish the conversation feed");
  if (firstTask) {
    await win("send", "--re", firstTask[1]!, "Starting. Rows per message are 6 today; aiming for 4.");
    await bot("send", "--re", firstTask[1]!, "Keep the event rows; fold only the duplicates.");
    await win("send", "--re", firstTask[1]!, "Down from 6 to 4. https://github.com/ojowwalker77/channels/pull/41");
    await win("task", "start", `T${firstTask[1]}`, "steady numbers look fine");
  }
  await bot("set", "relay.version", "667ce081");
  await bot("set", "canary", "off");
  await bot("send", "--to", "@win", "Can you take the cold runs after lunch?");
  await win("send", "--to", "@atlas", "Yes, after the steady load.");
  await owner.reload();
  await toTab("Conversation");
  await owner.getByText("Ship it as 0.8.12").first().waitFor({ timeout: 15000 });
  await owner.locator("button[aria-label='Reply']").last().dispatchEvent("click");
  await owner.getByPlaceholder(/^Reply/).fill("Ship it. The web follows tomorrow.");
  await owner.keyboard.press("Enter");
  await owner.waitForTimeout(400);
  // Work waiting on a person's review, and a decision an agent hands to its person: both under Needs you.
  const reviewed = /T\d+/.exec(await win("task", "add", "Cache sealed history in the browser", "--owner", "win", "--review", "any"))?.[0] ?? "T0";
  await win("task", "review", reviewed, "reload fetches only what is new");
  await win("escalate", "Should I delete the 800 test rooms on the old relay? It frees space, and it can't be undone.");
  const askPermission = (tool: string, given: object) => kiwi(["-c", "kiwi-w", "--as", "win", tool, JSON.stringify(given), "/Users/jonatas/www/channels"], undefined, "scripts/seed-permission.ts");
  const needsView = () =>
    owner
      .getByRole("complementary", { name: "Channel" })
      .getByRole("navigation", { name: "Views" })
      .getByRole("button", { name: /^Needs you/ });
  await askPermission("Bash", { command: "rm -rf web/dist && bun run web:build", description: "Rebuild the web bundle from scratch to check the size budget" });
  await needsView().click();
  await needs.getByText("rm -rf web/dist", { exact: false }).first().waitFor({ timeout: 15000 });
  await needs.getByRole("button", { name: "Deny" }).first().click();
  await owner
    .getByText(/^Deny sent to/)
    .first()
    .waitFor({ timeout: 15000 });
  await toTab("Conversation");
  await askPermission("Edit", { file_path: "/Users/jonatas/www/channels/web/src/lib/format.ts", old_string: "60_000", new_string: "60 * 1000", replace_all: true });
  // A direct conversation: the person and the lead, privately.
  await details().click();
  await owner.getByRole("button", { name: "More for atlas" }).click();
  await owner.getByRole("menuitem", { name: "Message privately" }).click();
  await composer().fill("Between us: is win overloaded? Tell me before you hand it more.");
  await owner.keyboard.press("Enter");
  await owner.waitForTimeout(400);
  const picture = join(data, "feed-rows.jpg");
  await owner.screenshot({ path: picture, type: "jpeg", quality: 70, scale: "css" });
  await bot("send", "--to", "@jonatas", "--image", picture, "Not overloaded. Here's the feed at 4 rows per message.");
  await owner.goto(channel);

  // An agent asking to join, left pending (its CLI waits in the background).
  void kiwi(["join", code, "kiwi-2", "--relay", BASE, "--as", "scout"], (o) => void (pendingOut = o)).catch(() => {});
  await needs
    .getByText(/scout/)
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => console.log(`no pending request to show: ${pendingOut.trim().split("\n").pop()}`));
  await owner.keyboard.press("Escape");

  // A second channel, still empty: it opens on how to add an agent.
  await newChannel.click();
  await owner.getByRole("dialog").getByRole("textbox").fill("fresh");
  await owner.getByRole("button", { name: "Create channel" }).click();
  await owner.waitForURL((u) => u.toString() !== channel && /#mc2-/.test(u.toString()));
  const fresh = owner.url();

  // ---------- shoot ----------
  let launcherStub = false;
  let terminalsStub = false;
  for (const theme of (["dark", "light"] as const).filter((t) => !themeOnly || t === themeOnly)) {
    for (const [vp, size] of (
      [
        ["wide", WIDE],
        ["narrow", NARROW],
      ] as const
    ).filter(([v]) => !wideOnly || v === "wide")) {
      const tag = `${theme}-${vp}`;
      await owner.setViewportSize(size);
      await owner.goto(channel);
      await setTheme(owner, theme);
      const narrow = vp === "narrow";
      const detailsBtn = () => owner.getByRole("button", { name: /^Details:/ });
      const details = () => owner.getByRole("complementary", { name: "Details" });
      const closeDetails = () => owner.getByRole("button", { name: "Close details" }).click();
      const tasksPanel = () => owner.getByRole("complementary", { name: "Tasks" });
      const account = () => owner.getByRole("complementary").getByRole("button", { name: /Jonatas/ });
      /** The channel as it opens on the conversation, scrolled to the latest. Reloaded: the hash alone keeps a panel open. */
      const toChannel = async () => {
        await owner.goto(channel);
        await owner.reload();
        await toTab("Conversation");
        await owner
          .getByText("Ship it as 0.8.12")
          .first()
          .waitFor({ timeout: 15000 })
          .catch(() => {});
      };
      /** A task's row on the Tasks tab, opened in the Tasks panel beside the board. */
      const openFromBoard = async (title: RegExp) => {
        await toTab("Tasks");
        const row = owner.getByRole("button", { name: title }).first();
        await row.waitFor({ timeout: 15000 });
        await row.click();
        await tasksPanel()
          .getByRole("region", { name: /^Task T\d+/ })
          .waitFor();
      };
      const toList = async () => {
        if (narrow) await owner.getByRole("button", { name: "Channels" }).click();
      };
      const fromList = async () => {
        await owner.keyboard.press("Escape");
        if (narrow) await toChannel();
      };
      const closeSettings = async () => {
        const back = owner.getByRole("button", { name: "Back to Settings" });
        if (await back.count()) await back.click();
        await owner.getByRole("button", { name: "Close settings" }).click();
        if (narrow) await toChannel();
      };
      const openSettings = async () => {
        await toList();
        await account().click();
        await owner.getByRole("menuitem", { name: "Settings" }).click();
        await owner.getByRole("region", { name: "Settings" }).waitFor();
      };
      const atNewest = async (when: string) => {
        let gap: number | null = null;
        for (const end = Date.now() + 5000; Date.now() < end; await owner.waitForTimeout(100)) {
          gap = await owner.evaluate(() => {
            const row = [...document.querySelectorAll("[id^='m']")].find((e) => /^m\d+$/.test(e.id));
            const el = row?.closest(".overflow-y-auto");
            return el ? el.scrollHeight - el.scrollTop - el.clientHeight : null;
          });
          if (gap !== null && gap < 80) return;
        }
        await owner.screenshot({ path: join(OUT, `${tag}-not-at-newest.png`) });
        throw new Error(`${tag}: ${when}, the conversation isn't at its newest message (${gap === null ? "no conversation" : `${Math.round(gap)}px above it`})`);
      };
      await toChannel();
      await atNewest("opening the channel");

      await shoot(owner, tag, "01-channel");
      await shoot(
        owner,
        tag,
        "01b-search",
        async () => {
          await owner.getByRole("complementary", { name: "Channel" }).getByRole("button", { name: "Search", exact: true }).click();
          await owner.getByRole("textbox", { name: "Search this channel" }).first().fill("rows");
        },
        async () => void (await owner.keyboard.press("Escape")),
      );
      await shoot(
        owner,
        tag,
        "01c-conversations-open",
        async () => {
          await owner
            .getByRole("complementary", { name: "Channel" })
            .getByRole("button", { name: /^\d+ more conversations?\b/ })
            .click();
        },
        async () => {
          await owner.getByRole("complementary", { name: "Channel" }).getByRole("button", { name: "Show less" }).click();
        },
      );
      await owner.mouse.wheel(0, -4000);
      await shoot(owner, tag, "02-channel-top");
      await shoot(owner, tag, "03-reply", async () => {
        await owner.locator("button[aria-label='Reply']").last().dispatchEvent("click");
        await owner.getByPlaceholder(/^Reply/).waitFor();
      });
      await shoot(
        owner,
        tag,
        "24-typing",
        () => owner.getByRole("textbox", { name: "Message" }).fill("Looks good to me; ship it once win signs off."),
        () => owner.getByRole("textbox", { name: "Message" }).fill(""),
      );
      await shoot(
        owner,
        tag,
        "04-tasks",
        () => toTab("Tasks"),
        () => toTab("Conversation"),
      );
      await toTab("Tasks");
      await toTab("Conversation");
      await atNewest("back on the conversation from Tasks");
      await shoot(owner, tag, "06-task-panel", () => openFromBoard(/Write fewer rows/), toChannel);
      await shoot(
        owner,
        tag,
        "15-needs-you",
        async () => {
          if (narrow) await toTab("Tasks");
          else
            await owner
              .getByRole("complementary", { name: "Channel" })
              .getByRole("navigation", { name: "Views" })
              .getByRole("button", { name: /^Needs you/ })
              .click();
          await owner.getByRole("region", { name: "Needs you" }).waitFor();
        },
        toChannel,
      );
      await shoot(
        owner,
        tag,
        "27-permission-thread",
        () =>
          owner
            .getByText(/Deny sent by/)
            .first()
            .scrollIntoViewIfNeeded(),
        () => owner.mouse.wheel(0, 8000),
      );
      await shoot(
        owner,
        tag,
        "17-agents",
        () => toTab("Agents"),
        () => toTab("Conversation"),
      );
      await shoot(owner, tag, "07-details", () => detailsBtn().click(), closeDetails);
      await shoot(
        owner,
        tag,
        "08-direct",
        async () => {
          await detailsBtn().click();
          await owner.getByRole("button", { name: "More for atlas" }).click();
          await owner.getByRole("menuitem", { name: "Message privately" }).click();
          await owner.getByPlaceholder(/privately$/).waitFor({ timeout: 15000 });
        },
        toChannel,
      );
      await shoot(
        owner,
        tag,
        "08b-picture",
        async () => {
          await detailsBtn().click();
          await owner.getByRole("button", { name: "More for atlas" }).click();
          await owner.getByRole("menuitem", { name: "Message privately" }).click();
          await owner.getByRole("button", { name: "Open feed-rows.jpg" }).last().click();
          await owner.getByRole("dialog", { name: /^Mark up / }).waitFor();
          if (vp === "wide") await owner.evaluate(macWindow, true);
          const caught = await owner.evaluate(dragCaught);
          if (caught.length) throw new Error(`the window's drag band takes the viewer's ${caught.join(", ")}`);
        },
        async () => {
          await owner.evaluate(macWindow, false);
          await owner.keyboard.press("Escape");
          await toChannel();
        },
      );
      await shoot(
        owner,
        tag,
        "09-invite",
        async () => {
          await detailsBtn().click();
          await details().getByRole("button", { name: "Invite", exact: true }).click();
          await details().getByRole("heading", { name: "Invite to this channel" }).waitFor();
        },
        toChannel,
      );
      await shoot(
        owner,
        tag,
        "10-account-menu",
        async () => {
          await toList();
          await account().click();
        },
        fromList,
      );
      await shoot(
        owner,
        tag,
        "11-palette",
        async () => {
          await toList();
          await owner.keyboard.press("ControlOrMeta+k");
        },
        fromList,
      );
      await shoot(
        owner,
        tag,
        "12-notes",
        async () => {
          await detailsBtn().click();
          const notes = details().getByRole("region", { name: "Notes" });
          await notes.scrollIntoViewIfNeeded();
          await notes.getByRole("button", { name: /^Notes/ }).click();
        },
        closeDetails,
      );
      await shoot(
        owner,
        tag,
        "13-pause",
        async () => {
          await detailsBtn().click();
          await details().getByRole("button", { name: "Pause agents" }).click();
        },
        toChannel,
      );
      await shoot(owner, tag, "14-list", toList, async () => {
        if (narrow) await toChannel();
      });
      await shoot(owner, tag, "18-settings", openSettings, closeSettings);
      if (["27-new-agents", "28-new-agents-ready"].some(wanted)) {
        if (!terminalsStub) {
          terminalsStub = true;
          await owner.addInitScript(() => {
            if (sessionStorage.getItem("shots.terminals") !== "1") return;
            type Row = { id: string; name: string; found: boolean; running: boolean; helpers: "on" | "off" | null };
            type Status = { prefer: string; launch: "on" | "off"; terminals: Row[] };
            const row = (id: string, name: string, helpers: Row["helpers"]): Row => ({ id, name, found: true, running: true, helpers });
            let status: Status = { prefer: "app", launch: "on", terminals: [row("rex", "Rex", "off"), row("tmux", "tmux", "off"), row("app", "Terminal", null)] };
            const set = async (change: (s: Status) => Status) => (status = change(status));
            const w = window as unknown as { kiwi?: object };
            w.kiwi = Object.assign(w.kiwi ?? {}, {
              terminals: async () => status,
              terminalHelpers: (id: string, to: "on" | "off") =>
                set((s) => ({ ...s, prefer: to === "off" && s.prefer === id ? "app" : s.prefer, terminals: s.terminals.map((t) => (t.id === id ? { ...t, helpers: to } : t)) })),
              terminalPrefer: (id: string) => set((s) => ({ ...s, prefer: id })),
              setLaunches: (to: "on" | "off") => set((s) => ({ ...s, launch: to })),
            });
          });
        }
        await owner.evaluate(() => sessionStorage.setItem("shots.terminals", "1"));
        await owner.reload();
        const newAgents = () => owner.getByRole("region", { name: "New agents" });
        await shoot(
          owner,
          tag,
          "27-new-agents",
          async () => {
            await openSettings();
            await newAgents().scrollIntoViewIfNeeded();
          },
          closeSettings,
        );
        await shoot(
          owner,
          tag,
          "28-new-agents-ready",
          async () => {
            await openSettings();
            await newAgents().getByRole("button", { name: "Download Rex Helpers" }).click();
            await newAgents().getByRole("button", { name: "Download Tmux Helpers" }).click();
            await newAgents().getByRole("radio", { name: "Rex" }).click();
            await newAgents().getByRole("radio", { name: "Rex", checked: true }).waitFor();
            await newAgents().scrollIntoViewIfNeeded();
          },
          closeSettings,
        );
        await owner.evaluate(() => sessionStorage.removeItem("shots.terminals"));
        await owner.reload();
      }
      await shoot(
        owner,
        tag,
        "19-personalities",
        async () => {
          await openSettings();
          await owner.getByRole("button", { name: /^Personalities/ }).click();
          await owner.getByRole("region", { name: "Personalities" }).waitFor();
        },
        closeSettings,
      );
      await owner.goto(fresh);
      await owner
        .getByRole("region", { name: "Add an agent" })
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await shoot(owner, tag, "16-add-agent");

      // The desktop app's New agent, with a stand-in for the four launch methods its bridge adds,
      // on only while this tab's flag is set so the other screens stay the browser's.
      if (["24-new-agent", "26-new-agent-remote", "25-new-agent-started"].some(wanted)) {
        if (!launcherStub) {
          launcherStub = true;
          await owner.addInitScript(() => {
            if (sessionStorage.getItem("shots.launcher") !== "1") return;
            const row = (harness: string, path: string | null, version: string | null, start: boolean) => ({ harness, path, version, start, wake: null, why: null });
            const rows = [
              row("claude", "/Users/you/.local/bin/claude", "2.1.304", true),
              row("codex", "/opt/homebrew/bin/codex", "0.98.0", true),
              row("gemini", "/opt/homebrew/bin/gemini", "0.31.0", false),
              row("opencode", "/opt/homebrew/bin/opencode", "1.4.2", false),
              row("cursor", null, null, false),
              row("grok", null, null, false),
            ];
            const block = "block:01a15ad9-310a-703a-ad0b-3cc137458451";
            const rex = { server: "unix:///Users/you/Library/Application%20Support/rex/server.sock", session: "session:01a15ad9-30f4-7bcb-8455-c3eeb9e1071c", block };
            (window as unknown as { kiwi: object }).kiwi = {
              harnesses: async () => rows,
              seatFolders: async () => ["/Users/you/code/payments", "/Users/you/code/payments-site"],
              chooseFolder: async () => null,
              launchAgent: async (req: { launch: string }) => ({ ok: true, launch: req.launch, place: "rex", rex }),
              machines: async () => [
                { machinePk: "own", label: "jow’s MacBook Air", os: "macOS", own: true, online: true },
                { machinePk: "build", label: "build-box", os: "Linux", own: false, online: true },
                { machinePk: "old", label: "old-mini", os: "macOS", own: false, online: false },
              ],
              harnessesOn: async () => ({ ok: true, value: rows.slice(0, 2).map((r) => ({ ...r, path: r.path?.replace("/Users/you", "/home/you") ?? null })) }),
              foldersOn: async () => ({ ok: true, value: ["/home/you/payments"] }),
            };
          });
        }
        await owner.evaluate(() => sessionStorage.setItem("shots.launcher", "1"));
        await owner.goto(fresh);
        await owner.reload();
        await owner.getByRole("region", { name: "Add an agent" }).waitFor({ timeout: 10000 });
        const dialog = owner.getByRole("dialog");
        await shoot(
          owner,
          tag,
          "24-new-agent",
          async () => {
            await owner.getByRole("region", { name: "Add an agent" }).getByRole("button", { name: "New agent" }).click();
            await dialog.getByRole("radiogroup", { name: "Harness" }).waitFor();
          },
          async () => {},
        );
        await shoot(
          owner,
          tag,
          "26-new-agent-remote",
          async () => {
            await dialog.getByRole("radiogroup", { name: "Computer" }).getByText("build-box").click();
            await dialog.getByText("/home/you").first().waitFor();
          },
          async () => {},
        );
        await shoot(owner, tag, "25-new-agent-started", async () => {
          await dialog.getByRole("button", { name: "Start" }).click();
          await dialog.getByText("Started in Rex").waitFor();
        });
        await owner.evaluate(() => sessionStorage.removeItem("shots.launcher"));
        await owner.reload();
      }

      // Signed out, and someone opening the invite link who isn't in yet.
      if (only && !["20-first-run", "21-join-with-code", "22-invite-preview", "23-signed-in-empty"].some(wanted)) continue;
      const out = await page(size);
      await out.goto(BASE);
      await setTheme(out, theme);
      await shoot(out, tag, "20-first-run");
      await firstRunAs(out, "Pat").catch(() => {});
      await shoot(out, tag, "23-signed-in-empty");
      await shoot(out, tag, "21-join-with-code", async () => {
        await out.getByRole("complementary").getByRole("button", { name: "New channel", exact: true }).click();
        await out.getByRole("dialog").getByRole("button", { name: "Have a code? Join" }).click();
      });
      await out.goto(`${BASE}#${encodeURIComponent(code)}`);
      await out
        .getByRole("heading", { name: /invited you to a channel|You’re invited to a channel/ })
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await shoot(out, tag, "22-invite-preview");
      await out.close();
    }
  }
} catch (e) {
  // Where it stopped, for whoever reads the failure.
  for (const ctx of browser.contexts()) for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: join(OUT, `failed-${i}.png`) }).catch(() => {});
  console.log(`last CLI output: ${pendingOut.trim().split("\n").slice(-3).join(" | ")}`);
  throw e;
} finally {
  await browser.close();
  for (const p of running) p.kill();
  relay.kill();
  rmSync(data, { recursive: true, force: true });
}
console.log(`\n${shots.length} screenshots in ${OUT}`);
if (skipped.length) {
  console.log(`skipped ${skipped.length}: ${skipped.join(", ")}`);
  process.exit(1);
}
