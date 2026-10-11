// Screenshots of every screen of the dashboard, for design work: each surface in dark and light,
// wide and narrow, as the owner, as someone invited, and signed out. Seeds a realistic channel
// first (an agent on a linked computer, messages, a thread, tasks, claims, facts, a room, a
// pending join request), the same way scripts/smoke-ui.ts walks the flows.
//
//   bun run web:build && bun scripts/shoot-ui.ts [outdir]
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn, type ChildProcess } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Page } from "playwright-core"

const ROOT = resolve(import.meta.dir, "..")
const OUT = resolve(process.argv[2] ?? join(tmpdir(), "kiwi-shots"))
mkdirSync(OUT, { recursive: true })
const PORT = 20000 + Math.floor(Math.random() * 20000)
const BASE = `http://localhost:${PORT}/`
const data = mkdtempSync(join(tmpdir(), "kiwi-shots-"))

const cli = join(data, "cli")
mkdirSync(join(cli, "bin"), { recursive: true })
mkdirSync(join(data, "relay"))
for (const opener of ["open", "xdg-open"]) {
  writeFileSync(join(cli, "bin", opener), "#!/bin/sh\nexit 0\n")
  chmodSync(join(cli, "bin", opener), 0o755)
}
const cliEnv = { ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` }
const running: ChildProcess[] = []
function kiwi(args: string[], watch?: (out: string) => void): Promise<string> {
  const p = spawn("bun", ["src/cli/main.ts", ...args], { cwd: ROOT, env: cliEnv })
  running.push(p)
  let out = ""
  const on = (d: Buffer) => ((out += d), watch?.(out))
  p.stdout.on("data", on)
  p.stderr.on("data", on)
  return new Promise((ok, fail) => p.on("exit", (code) => (code === 0 ? ok(out) : fail(new Error(`kiwi ${args.join(" ")} exited ${code}: ${out.trim().split("\n").pop()}`)))))
}
let pendingOut = ""
const bot = (...args: string[]) => kiwi(["-c", "kiwi", "--as", "atlas", ...args])

const relay = spawn("bun", ["src/relay/bun.ts", "--hostname", "127.0.0.1", "--port", String(PORT), "--data", join(data, "relay"), "--dev-sign-in"], { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] })
await new Promise<void>((ok, fail) => {
  let out = ""
  relay.stdout!.on("data", (d) => {
    out += d
    if (out.includes("dashboard: not served")) fail(new Error("web/dist is missing: run bun run web:build first"))
    else if (out.includes("dashboard:")) ok()
  })
  relay.on("exit", (code) => fail(new Error(`relay exited (${code})`)))
})

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 390, height: 844 }
const shots: string[] = []

async function signIn(page: Page, name: string) {
  await page.getByRole("button", { name: "Sign in" }).first().click()
  await page.getByRole("textbox", { name: "Name" }).fill(name)
  await page.getByRole("dialog").getByRole("button", { name: "Sign in" }).click()
  await page.getByRole("complementary").getByRole("button", { name: new RegExp(name, "i") }).waitFor()
}

async function passkey(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true },
  } as never)
}

async function setTheme(page: Page, theme: "dark" | "light") {
  await page.evaluate((t) => localStorage.setItem("mc.appearance", t), theme)
  await page.reload()
  await page.waitForLoadState("networkidle")
}

/** One named screen: get there, wait for it to settle, shoot it, put things back. */
async function shoot(page: Page, tag: string, name: string, open?: () => Promise<void>, close: () => Promise<void> = async () => void (await page.keyboard.press("Escape"))) {
  try {
    if (open) await open()
    await page.waitForTimeout(350)
    const file = join(OUT, `${tag}-${name}.png`)
    await page.screenshot({ path: file })
    shots.push(file)
    console.log(`shot ${tag}-${name}`)
  } catch (e) {
    console.log(`skip ${tag}-${name}: ${e instanceof Error ? e.message.split("\n")[0] : e}`)
  } finally {
    await close().catch(() => {})
    await page.waitForTimeout(150)
  }
}

try {
  // ---------- seed: the owner, a channel, an agent on a linked computer, a pending request ----------
  const owner = await browser.newPage({ viewport: WIDE })
  await owner.goto(BASE)
  await signIn(owner, "Jonatas")
  await passkey(owner)
  await owner.getByRole("button", { name: "Save channels to a passkey" }).click()
  const saving = owner.getByRole("dialog").filter({ hasText: "Save your recovery code" })
  await saving.waitFor()
  await saving.getByRole("checkbox").check()
  await saving.getByRole("button", { name: "Done" }).click()
  await saving.waitFor({ state: "hidden" })

  const plus = owner.getByRole("button", { name: "New channel or join" })
  await plus.click()
  await owner.getByRole("menuitem", { name: "New channel" }).click()
  await owner.getByRole("dialog").getByRole("textbox").fill("kiwi")
  await owner.getByRole("button", { name: "Create channel" }).click()
  await owner.waitForURL(/#mc2-/)
  const channel = owner.url()
  const code = decodeURIComponent(new URL(channel).hash.slice(1))

  let opened = false
  const setup = kiwi(["setup", "--relay", BASE], (out) => {
    const link = /(http\S+#link=\S+)/.exec(out)?.[1]
    if (link && !opened) (opened = true), void owner.goto(link)
  })
  await owner.getByRole("button", { name: "Yes, link it" }).click({ timeout: 20000 })
  await setup
  await owner.goto(channel)
  // Linking it here made this browser trust that computer; ask each time instead, so the requests
  // sheet and a pending request are there to shoot.
  await owner.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("mc.trusted-computers.")) localStorage.setItem(`mc.auto-admit.${k.slice("mc.trusted-computers.".length)}`, "false")
  })
  const joining = kiwi(["join", code, "kiwi", "--relay", BASE, "--as", "atlas", "--role", "backend"])
  const review = owner.getByRole("button", { name: "Review", exact: true })
  await review.waitFor({ timeout: 30000 })
  await review.click()
  await owner.getByRole("button", { name: "Review and approve" }).click()
  await owner.getByRole("button", { name: "Approve", exact: true }).click()
  await joining
  await owner.waitForTimeout(500)
  if (await owner.getByRole("dialog").count()) await owner.keyboard.press("Escape")

  // The conversation: chat, a question, a thread, a long message with code, tasks, a claim, facts.
  const composer = () => owner.getByPlaceholder(/^Write (to the channel|in #)/)
  await composer().fill("Morning. The relay deploy is done; can someone check the Effect router numbers?")
  await owner.keyboard.press("Enter")
  await owner.waitForTimeout(400)
  await bot("send", "On it. Steady load first, then the cold runs.")
  await bot("send", "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`, one prebuilt program per request:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```")
  await bot("ask", "--to", "jonatas", "Ship it as 0.8.12, or wait for the web?")
  const firstTask = /T\d+/.exec(await bot("task", "add", "Write fewer rows per message", "--owner", "atlas"))?.[0] ?? "T0"
  await bot("task", "add", "Polish the conversation feed")
  await bot("send", `${firstTask}: rows per message are down from 6 to 4. https://github.com/ojowwalker77/channels/pull/41`)
  await bot("claim", "src/relay/room.ts", "--note", "fewer writes")
  await bot("set", "relay.version", "667ce081")
  await bot("set", "canary", "off")
  await owner.reload()
  await owner.getByText("Ship it as 0.8.12").first().waitFor({ timeout: 15000 })
  await owner.locator("button[aria-label='Reply']").last().dispatchEvent("click")
  await owner.getByRole("button", { name: "Close thread" }).waitFor()
  await owner.getByPlaceholder(/^Reply/).fill("Ship it. The web follows tomorrow.")
  await owner.keyboard.press("Enter")
  await owner.waitForTimeout(400)
  await owner.getByRole("button", { name: "Close thread" }).click()
  await bot("task", "start", firstTask, "steady numbers look fine")

  // A room, with a message in it.
  await owner.getByRole("button", { name: "New room" }).click()
  await owner.getByRole("textbox", { name: "Room name" }).fill("design")
  await owner.getByRole("button", { name: "Create room" }).click()
  await owner.getByPlaceholder(/^Write in #design/).waitFor()
  await owner.getByPlaceholder(/^Write in #design/).fill("Moodboard: Linear's activity feed, one reading column.")
  await owner.keyboard.press("Enter")
  await owner.getByRole("list", { name: "Rooms" }).getByRole("button", { name: /general/ }).click()

  // An agent asking to join, left pending (its CLI waits in the background).
  void kiwi(["join", code, "kiwi-2", "--relay", BASE, "--as", "scout", "--role", "frontend"], (o) => void (pendingOut = o)).catch(() => {})
  await review.waitFor({ timeout: 30000 }).catch(() => console.log(`no pending request to show: ${pendingOut.trim().split("\n").pop()}`))

  // ---------- shoot ----------
  for (const theme of ["dark", "light"] as const) {
    for (const [vp, size] of [["wide", WIDE], ["narrow", NARROW]] as const) {
      const tag = `${theme}-${vp}`
      await owner.setViewportSize(size)
      await owner.goto(channel)
      await setTheme(owner, theme)
      await owner.getByText("Ship it as 0.8.12").first().waitFor({ timeout: 15000 }).catch(() => {})

      await shoot(owner, tag, "01-channel")
      await owner.mouse.wheel(0, -4000)
      await shoot(owner, tag, "02-channel-top")
      await shoot(owner, tag, "03-thread", async () => {
        await owner.locator("button[aria-label='Reply']").last().dispatchEvent("click")
        await owner.getByRole("button", { name: "Close thread" }).waitFor()
      }, () => owner.getByRole("button", { name: "Close thread" }).click())
      await shoot(owner, tag, "04-tasks", () => owner.getByRole("tab", { name: /^Work/ }).click(), () => owner.getByRole("tab", { name: "Chat" }).click())
      await shoot(owner, tag, "05-task-page", async () => {
        await owner.getByRole("tab", { name: /^Work/ }).click()
        await owner.getByRole("button", { name: /Write fewer rows/ }).first().click()
        await owner.getByRole("heading", { name: "Activity" }).waitFor()
      }, async () => {
        await owner.getByRole("button", { name: "Close task" }).click()
        await owner.getByRole("tab", { name: "Chat" }).click()
      })
      await shoot(owner, tag, "06-people", () => owner.getByRole("button", { name: /\d+ members?$/ }).click())
      await shoot(owner, tag, "07-invite", () => owner.getByRole("button", { name: "Invite" }).click())
      await shoot(owner, tag, "08-channel-menu", () => owner.getByRole("button", { name: "Channel menu" }).click())
      await shoot(owner, tag, "09-account-menu", () => owner.getByRole("complementary").getByRole("button", { name: /Jonatas/i }).click())
      await shoot(owner, tag, "10-settings", async () => {
        await owner.getByRole("complementary").getByRole("button", { name: /Jonatas/i }).click()
        await owner.getByRole("menuitem", { name: "Settings…" }).click()
      })
      await shoot(owner, tag, "11-palette", () => owner.getByRole("button", { name: /^Go to…/ }).click())
      await shoot(owner, tag, "12-composer-kind", () => owner.getByRole("button", { name: /^Message/ }).click())
      await shoot(owner, tag, "13-join-request", () => review.click())
      await shoot(owner, tag, "14-room", () => owner.getByRole("list", { name: "Rooms" }).getByRole("button", { name: /design/ }).click(), () =>
        owner.getByRole("list", { name: "Rooms" }).getByRole("button", { name: /general/ }).click(),
      )
      await shoot(owner, tag, "15-new-channel-menu", () => owner.getByRole("button", { name: "New channel or join" }).click())

      // Signed out, and someone opening the invite link who isn't in yet.
      const out = await browser.newPage({ viewport: size })
      await out.goto(BASE)
      await setTheme(out, theme)
      await shoot(out, tag, "20-signed-out")
      await shoot(out, tag, "21-join-with-code", () => out.getByRole("main").getByRole("button", { name: "Join with a code" }).click())
      await out.goto(`${BASE}#${encodeURIComponent(code)}`)
      await out.getByRole("heading", { name: /invited you to a channel/ }).waitFor({ timeout: 10000 }).catch(() => {})
      await shoot(out, tag, "22-invite-preview")
      // Signed in, no channels yet.
      await out.goto(BASE)
      await signIn(out, "Pat").catch(() => {})
      await shoot(out, tag, "23-signed-in-empty")
      await out.close()
    }
  }
} finally {
  await browser.close()
  for (const p of running) p.kill()
  relay.kill()
  rmSync(data, { recursive: true, force: true })
}
console.log(`\n${shots.length} screenshots in ${OUT}`)
