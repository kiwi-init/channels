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

import { spawn } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Locator, type Page } from "playwright-core"

const ROOT = resolve(import.meta.dir, "..")
const PORT = 20000 + Math.floor(Math.random() * 20000)
// localhost, not 127.0.0.1: WebAuthn refuses an IP address as the passkey's site.
const BASE = `http://localhost:${PORT}/`
const data = mkdtempSync(join(tmpdir(), "kiwi-smoke-"))

// A computer of the smoke person's, for an agent to join from: its own kiwi home, no Claude Code
// settings to touch, and no browser to open (kiwi setup opens the link page; the test visits it).
const cli = join(data, "cli")
mkdirSync(join(cli, "bin"), { recursive: true })
mkdirSync(join(data, "relay"))
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n")
  chmodSync(join(cli, "bin", opener), 0o755)
}
/** A person's own terminal: none of the variables an agent's harness sets (the smoke may itself run inside one). */
const PERSON = { CLAUDECODE: "", CODEX_THREAD_ID: "", GEMINI_CLI: "", CURSOR_AGENT: "", GROK_SESSION_ID: "", OPENCODE_SESSION_ID: "" }
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` }
/** Run kiwi as that computer; resolves with its output once it exits, and lets you watch it meanwhile. */
function kiwi(args: string[], watch?: (out: string) => void): Promise<string> {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv })
  let out = ""
  const on = (d: Buffer) => ((out += d), watch?.(out))
  p.stdout.on("data", on)
  p.stderr.on("data", on)
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args[0]} exited ${code}: ${out.trim().split("\n").pop()}`)))))
}

const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", String(PORT), "--data", join(data, "relay"), "--web", "web/dist", "--dev-sign-in"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] })
await new Promise<void>((ok, fail) => {
  let out = ""
  relay.stdout!.on("data", (d) => {
    out += d
    if (out.includes("site: not served")) fail(new Error("web/dist is missing: run bun run web:build first"))
    else if (out.includes("site:")) ok()
  })
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)))
})

const errors: string[] = []
let at = "start"
// The relay is a child process: if the browser can't start, stop it too, or this never exits.
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined }).catch((e) => {
  relay.kill()
  rmSync(data, { recursive: true, force: true })
  throw e
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on("pageerror", (e) => errors.push(`${at}: ${e.message}`))
page.on("console", (m) => {
  // A refused request is the app's business (and logged by the browser); a thrown render is not.
  if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(`${at}: console: ${m.text()}`)
})

const popup = (p: Page) => p.locator("[role=menu], [role=dialog], [role=alertdialog]").last()

/** Open something, check its popup rendered, close it with Escape. */
async function opens(name: string, open: () => Promise<void>) {
  at = name
  await open()
  await popup(page).waitFor({ state: "visible", timeout: 5000 })
  // Escape until nothing's open: a dialog opened from a menu item can still be mounting when the first one lands.
  const open_ = page.locator("[role=menu], [role=dialog], [role=alertdialog]")
  for (let i = 0; i < 3 && (await open_.count()) > 0; i++) {
    await page.keyboard.press("Escape")
    await open_.first().waitFor({ state: "hidden", timeout: 2000 }).catch(() => {})
  }
  if ((await open_.count()) > 0) throw new Error(`${name} didn't close with Escape`)
  await page.waitForTimeout(150)
  console.log(`ok  ${name}`)
}

/** Every item in a menu that opens something else ("Rename…", "Your computers"), each once. */
async function eachItem(name: string, trigger: Locator, only: (label: string) => boolean) {
  await trigger.click()
  await page.getByRole("menu").waitFor()
  const labels = (await page.getByRole("menu").getByRole("menuitem").allInnerTexts()).map((s) => s.trim()).filter(only)
  await page.keyboard.press("Escape")
  for (const label of labels)
    await opens(`${name} → ${label}`, async () => {
      await trigger.click()
      await page.getByRole("menu").waitFor()
      await page.getByRole("menu").getByRole("menuitem", { name: label, exact: true }).click()
    })
}

try {
  await page.goto(BASE)
  // 0.11: no account in the browser. You name yourself once and Kiwi makes your person key here.
  at = "first run"
  await page.getByRole("textbox").first().fill("smoke")
  await page.getByRole("button", { name: "Continue" }).click()
  // The account pill: the list's one menu button with the person's name (a channel may share it).
  const account = page.getByRole("complementary").locator('button[aria-haspopup="menu"]', { hasText: "smoke" })
  await account.waitFor()
  console.log(`ok  ${at}`)

  await opens("Account menu", () => account.click())
  await eachItem("Account menu", account, () => true)

  // Settings: dark, and the largest text, so every menu and dialog below opens with it too.
  at = "Settings → Dark, Larger"
  await account.click()
  await page.getByRole("menuitem", { name: "Settings…" }).click()
  const settings = page.getByRole("dialog").filter({ hasText: "Text size" })
  await settings.getByRole("radio", { name: "Dark" }).click()
  await settings.getByRole("radio", { name: "Larger" }).click()
  await settings.getByRole("button", { name: "Done" }).click()
  await settings.waitFor({ state: "hidden" })
  // Text size scales the type steps, not the page.
  if ((await page.evaluate(() => document.documentElement.style.getPropertyValue("--text-scale"))) !== "1.22") throw new Error("the text size didn't apply")
  console.log(`ok  ${at}`)
  await opens("Search palette", () => page.keyboard.press("ControlOrMeta+k"))
  // New is the list's first row, joining beside it.
  const newChannel = page.getByRole("complementary").getByRole("button", { name: "New channel", exact: true })
  await opens("Join with a code", async () => {
    await newChannel.click()
    await page.getByRole("dialog").getByRole("button", { name: "Have a code? Join" }).click()
  })

  at = "create a channel"
  await newChannel.click()
  await page.getByRole("dialog").getByRole("textbox").fill("smoke")
  await page.getByRole("button", { name: "Create channel" }).click()
  await page.waitForURL(/#mc2-/)
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  // An empty channel opens on how to add an agent: one command, with its join code.
  at = "Add an agent card"
  const addAgent = page.getByRole("region", { name: "Add an agent" })
  await addAgent.waitFor()
  const card = await addAgent.innerText()
  if (!/sh -s -- join mc2-/.test(card)) throw new Error("the Add an agent card has no join command")
  // Not the public relay: the line names this one, or kiwi would ask the public relay about this channel.
  if (!card.includes(`--relay ${new URL(BASE).origin}`)) throw new Error("the Add an agent command doesn't name this relay")
  console.log(`ok  ${at}`)

  // Someone who isn't in yet, opening the join link: the preview names the owner.
  // That fetch has to send the code's fingerprint, or /info answers 426 and the name never arrives.
  at = "invite preview"
  const inviteCode = decodeURIComponent(new URL(page.url()).hash.slice(1))
  const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  guest.on("pageerror", (e) => errors.push(`${at}: ${e.message}`))
  try {
    await guest.goto(`${BASE}#${encodeURIComponent(inviteCode)}`)
    // A new person names themself first (0.11's first run), then sees whose invite it is.
    const firstRun = guest.getByRole("button", { name: "Continue" })
    if (await firstRun.isVisible({ timeout: 5000 }).catch(() => false)) {
      await guest.getByRole("textbox").first().fill("guest")
      await firstRun.click()
    }
    // "X invited you to a channel" when the relay knows the owner's name; 0.11's relays don't (no sign-in).
    await guest.getByRole("heading", { name: /invited you to a channel|You’re invited to a channel/ }).waitFor({ timeout: 10000 })
    console.log(`ok  ${at}`)
  } finally {
    await guest.close()
  }

  // The channel's details, as Messages shows a chat's Info: the faces and name in the header open them.
  const details = page.getByRole("button", { name: /^Details:/ })
  const panel = page.getByRole("complementary", { name: "Details" })
  /** Open the details (if they aren't), then do something in them. */
  const inDetails = async (fn: () => Promise<void>) => {
    if (!(await panel.isVisible())) await details.click()
    await panel.waitFor()
    await fn()
  }
  at = "Details"
  await inDetails(async () => {})
  console.log(`ok  ${at}`)
  await opens("Invite", () => inDetails(() => panel.getByRole("button", { name: "Invite", exact: true }).click()))
  await opens("Invite → A person", () =>
    inDetails(async () => {
      await panel.getByRole("button", { name: "Invite", exact: true }).click()
      await page.getByRole("dialog").getByRole("tab", { name: "A person" }).or(page.getByRole("dialog").getByRole("button", { name: "A person" })).first().click()
    })
  )
  // (0.11 has no "Use in a terminal…": a computer's agents come in through pairing, in the desktop app.)
  for (const item of ["Charter", "Rename channel"]) await opens(`Details → ${item}`, () => inDetails(() => panel.getByRole("button", { name: new RegExp(`^${item}`) }).click()))
  // Escape (which closes each dialog above) may have closed the details too.
  if (await panel.isVisible()) await panel.getByRole("button", { name: "Close details" }).click()
  at = "send and reply"
  await page.getByRole("textbox", { name: "Message" }).fill("smoke test")
  await page.keyboard.press("Enter")
  const row = page.getByText("smoke test", { exact: true }).first()
  await row.waitFor()
  // The row's actions only show on hover, which headless pointers lose easily: click it directly.
  await page.locator("button[aria-label='Reply']").first().dispatchEvent("click")
  await page.getByRole("button", { name: "Close thread" }).waitFor()
  await page.getByRole("button", { name: "Close thread" }).click()
  console.log("ok  Thread panel")
  // Once there's something going on, the owner's stop button is in the details (the name opens them).
  await opens("Pause agents", () => inDetails(() => panel.getByRole("button", { name: /^Pause (all )?agents$/ }).click()))

  // The sent message is sealed in this browser. A reload paints it and the
  // socket asks only for seqs after that row. "smoke test" contains a space,
  // which ciphertext (base64url) cannot, so a stored body fails this check.
  at = "history cache"
  await page.waitForFunction(async () => {
    const rows = await new Promise<unknown[]>((resolve) => {
      const req = indexedDB.open("mc.history")
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("rows")) {
          db.close()
          resolve([])
          return
        }
        const all = db.transaction("rows", "readonly").objectStore("rows").getAll()
        all.onsuccess = () => {
          db.close()
          resolve(all.result as unknown[])
        }
        all.onerror = () => {
          db.close()
          resolve([])
        }
      }
      req.onerror = () => resolve([])
    })
    return rows.length > 0 && !JSON.stringify(rows).includes("smoke test")
  }, undefined, { timeout: 5000 })
  console.log("ok  history cache sealed")

  at = "reload fetches only what is new"
  const sinceOnReload = new Promise<string>((resolve) => {
    const onWs = (ws: { url: () => string }) => {
      const since = new URL(ws.url()).searchParams.get("since")
      if (since == null) return
      page.off("websocket", onWs)
      resolve(since)
    }
    page.on("websocket", onWs)
  })
  await page.reload()
  await page.getByText("smoke test", { exact: true }).first().waitFor()
  const since = await sinceOnReload
  if (!(Number(since) > 0)) throw new Error(`reload streamed since ${since}; expected only newer seqs`)
  await account.waitFor()
  console.log(`ok  reload fetches only what is new (since ${since})`)

  // An agent asks to join: Needs you shows the request (its model and machine), its code, and one
  // click; what it can do is the default unless chosen. (A paired computer's agents come in on their
  // own, but pairing is the desktop app's: a browser has no bridge to pair with.)
  at = "an agent asks"
  const channel = page.url()
  const code = new URL(channel).hash.slice(1)
  const joining = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "bot", "--role", "tester"])
  const needs = page.getByRole("region", { name: "Needs you" })
  // Needs you is a slim banner; what's in it opens under it.
  const needsOpen = async () => {
    const banner = needs.getByRole("button", { name: /needs? you/ }).first()
    await banner.waitFor({ timeout: 30000 })
    if ((await banner.getAttribute("aria-expanded")) !== "true") await banner.click()
  }
  const letIn = needs.getByRole("button", { name: "It matches: let in" })
  const showCode = needs.getByRole("button", { name: "Show code" })
  await needsOpen()
  await letIn.or(showCode).first().waitFor({ timeout: 30000 })
  if (await showCode.count()) await showCode.click()
  await letIn.waitFor({ timeout: 30000 })
  // The request says what the agent runs on: its model first.
  await needs.getByText("claude-sonnet-5-5").first().waitFor({ timeout: 5000 })
  console.log(`ok  ${at} (its model shows)`)
  await opens("Needs you → Choose what it can do…", () => needs.getByRole("button", { name: "Choose what it can do…" }).click())
  at = "approve"
  await needsOpen()
  await letIn.click()
  await joining
  await addAgent.waitFor({ state: "hidden", timeout: 15000 })
  console.log(`ok  ${at}`)

  at = "a second agent"
  await page.goto(channel)
  await page.getByText("smoke test", { exact: true }).first().waitFor()
  const helper = kiwi(["join", code, "smoke", "--relay", BASE, "--as", "helper"])
  await needsOpen()
  await letIn.or(showCode).first().waitFor({ timeout: 30000 })
  if (await showCode.count()) await showCode.click()
  await letIn.click({ timeout: 30000 })
  await helper
  console.log(`ok  ${at}`)

  // Read receipts (T1554): once the agents it went to have read your newest message, it says so.
  at = "read receipt"
  await page.getByRole("textbox", { name: "Message" }).fill("smoke, read me")
  await page.keyboard.press("Enter")
  await page.getByText("smoke, read me", { exact: true }).first().waitFor()
  // Nothing yet: an agent counts only once it has ever said how far it read (an older kiwi never does).
  for (const as of ["bot", "helper"]) await kiwi(["-c", "smoke", "--as", as, "listen", "--now"])
  await page.getByText(/^Read( by|\s\d)/).waitFor({ timeout: 15000 })
  if (process.env.SMOKE_SHOTS) await page.screenshot({ path: join(process.env.SMOKE_SHOTS, "read.png") })
  console.log(`ok  ${at}`)

  at = "read receipt in a thread"
  await page.locator("button[aria-label='Reply']").last().dispatchEvent("click")
  const thread = page.getByRole("complementary", { name: "Thread" })
  await thread.getByRole("textbox", { name: "Message" }).fill("smoke, read my reply")
  await page.keyboard.press("Enter")
  await thread.getByText("smoke, read my reply", { exact: true }).waitFor()
  for (const as of ["bot", "helper"]) await kiwi(["-c", "smoke", "--as", as, "listen", "--now"])
  await thread.getByText(/^Read( by|\s\d|$)/).waitFor({ timeout: 15000 })
  await page.getByRole("button", { name: "Close thread" }).click()
  console.log(`ok  ${at}`)

  await kiwi(["-c", "smoke", "--as", "bot", "task", "add", "Smoke task", "--owner", "bot"])
  // A task has its own conversation, in the Tasks panel beside the chat (the header's Tasks button):
  // the task opens there on its details, its activity a tap away, with what's said in it under them.
  at = "Task in the Tasks panel"
  const conversations = page.getByRole("main").getByRole("navigation", { name: "Conversations" })
  const tasksButton = page.getByRole("main").getByRole("button", { name: "Tasks", exact: true })
  const tasksPanel = page.getByRole("complementary", { name: "Tasks" })
  await tasksButton.click({ timeout: 15000 })
  await tasksPanel.getByRole("button", { name: /Smoke task/ }).first().click({ timeout: 15000 })
  await tasksPanel.getByRole("region", { name: /^Task T\d+/ }).getByRole("button", { name: /^Activity/ }).click()
  await tasksPanel.getByRole("textbox", { name: /^Comment on T\d+/ }).waitFor()
  // In a task's conversation, a message goes to the task's thread, and main never shows it.
  await tasksPanel.getByRole("textbox", { name: "Message" }).fill("smoke in the task")
  await page.keyboard.press("Enter")
  await tasksPanel.getByText("smoke in the task", { exact: true }).first().waitFor()
  await tasksPanel.getByRole("button", { name: "Close tasks" }).click()
  if (await page.getByText("smoke in the task", { exact: true }).count()) throw new Error("a message in a task's conversation showed in main")
  console.log(`ok  ${at}`)
  // What the owner can do to a member: each item behind their face in the details.
  for (const item of ["Set role…", "Remove from channel…"])
    await opens(`Details → bot → ${item}`, () =>
      inDetails(async () => {
        await panel.getByRole("button", { name: "More for bot" }).click()
        await page.getByRole("menuitem", { name: item }).click()
      })
    )

  // Coordinator mode lives in the details panel: Turn off takes the role away, Turn on picks who holds it.
  at = "Coordinator mode off and on"
  // An event line says it in a few words; its tooltip has the whole of it.
  await page.locator('[title*="turned on coordinator-only"]').first().waitFor({ state: "attached", timeout: 15000 })
  // Whoever relays now (bot or helper): turning off takes it from them (nothing, if nobody does yet).
  const relays = await panel.getByText(/relays/).innerText().catch(() => "")
  const relaying = /on \((.*) relays\)/.exec(relays)?.[1]
  await inDetails(async () => {
    await panel.getByRole("button", { name: "Turn off" }).click()
  })
  if (relaying) {
    // The mode goes off first (so nobody re-appoints in between), then the role: the role is the newest line.
    await page.getByText(`${relaying} has no role now`).first().waitFor({ timeout: 15000 })
  }
  await panel.getByText(/Coordinator mode: off/).waitFor({ timeout: 15000 })
  await inDetails(async () => {
    await panel.getByRole("button", { name: "Turn on" }).click()
    await page.getByRole("dialog").getByRole("button", { name: /bot/ }).click()
  })
  await panel.getByText(/Coordinator mode: on \(bot relays\)/).waitFor({ timeout: 15000 })
  // A direct conversation with a member, from their face.
  await panel.getByRole("button", { name: "More for bot" }).click()
  await page.getByRole("menuitem", { name: "Message privately" }).click()
  await page.getByRole("textbox", { name: "Message" }).fill("smoke, privately")
  await page.keyboard.press("Enter")
  await page.getByText("smoke, privately", { exact: true }).first().waitFor({ timeout: 15000 })
  // Away from main, the name's capsule leads with the way back.
  await conversations.getByRole("button", { name: "Back to chat" }).click()
  await conversations.getByRole("button", { name: "Back to chat" }).waitFor({ state: "detached" })
  console.log(`ok  ${at} and a direct conversation`)

  // The panel lists the tasks; one opened from it has a way back to the list, and Escape closes the panel.
  at = "Tasks panel"
  await tasksButton.click()
  await tasksPanel.getByRole("button", { name: /Smoke task/ }).first().click()
  await tasksPanel.getByRole("button", { name: "All tasks" }).click()
  await tasksPanel.getByRole("textbox", { name: "Filter tasks" }).waitFor()
  await page.keyboard.press("Escape")
  await tasksPanel.waitFor({ state: "detached" })
  await page.getByRole("textbox", { name: "Message" }).waitFor()
  console.log(`ok  ${at}`)

  // (Not walked in 0.11: news in a channel that isn't open. 0.10 read every channel's head from the
  // signed-in account's listing on the relay; 0.11 has no account, and its list is local only, so a
  // closed channel shows its news once it's opened. To come back once the app reads heads itself.)

  // Anything that announces a popup and isn't covered above: new menus get opened too.
  const triggers = await page.locator("[aria-haspopup]:visible").all()
  for (const [i, t] of triggers.entries()) {
    const label = (await t.getAttribute("aria-label")) || (await t.innerText()).trim().split("\n").pop()!.slice(0, 30) || `#${i}`
    if (!(await t.isEnabled())) continue
    await opens(`sweep: ${label}`, () => t.click())
  }
} catch (e) {
  errors.push(`${at}: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)}`)
  await page.screenshot({ path: join(tmpdir(), "kiwi-smoke-failure.png") }).catch(() => {})
} finally {
  await browser.close()
  relay.kill()
  rmSync(data, { recursive: true, force: true })
}

if (errors.length) {
  console.error(`\nUI smoke failed:\n${errors.map((e) => `  ${e}`).join("\n")}\n(screenshot, if any: ${join(tmpdir(), "kiwi-smoke-failure.png")})`)
  process.exit(1)
}
console.log("\nUI smoke passed")
