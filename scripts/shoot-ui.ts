// Screenshots of every screen of the dashboard, for design work: each surface in dark and light,
// wide and narrow, as the owner, as someone invited, and signed out. Seeds a realistic channel
// first (a coordinator and an agent working a task, messages, a thread, a task's conversation, a
// direct one, notes, a pending join request), the same way scripts/smoke-ui.ts walks the flows.
//
//   bun run web:build && bun scripts/shoot-ui.ts [outdir] [--only channel,task-thread,…] [--wide] [--theme dark|light]
//
// Shots are taken at 2x (Retina), as most people see the dashboard. --only keeps the screens whose
// name contains one of the words (and skips the signed-out ones unless named), --wide skips the phone
// size, --theme keeps one theme: for a quick look at a few screens while working on them.
//
// Needs Playwright's Chromium: bunx playwright-core install --only-shell chromium
// (or set SMOKE_CHROMIUM to a Chrome binary).

import { spawn, type ChildProcess } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { chromium, type Page } from "playwright-core"

const ROOT = resolve(import.meta.dir, "..")
const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : (args.splice(i, 2)[1] ?? "")
}
const only = flag("--only")?.split(",").filter(Boolean)
const themeOnly = flag("--theme")
const wideOnly = args.includes("--wide") ? (args.splice(args.indexOf("--wide"), 1), true) : false
const OUT = resolve(args[0] ?? join(tmpdir(), "kiwi-shots"))
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
const cliEnv = { KIWI_MODEL: "claude-sonnet-5-5", ...process.env, KIWI_HOME: join(cli, "home"), CLAUDE_CONFIG_DIR: join(cli, "no-claude"), PATH: `${join(cli, "bin")}:${process.env.PATH}` }
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
const win = (...args: string[]) => kiwi(["-c", "kiwi-w", "--as", "win", ...args])

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

const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined })
const WIDE = { width: 1440, height: 900 }
const NARROW = { width: 390, height: 844 }
const shots: string[] = []
/** Retina, as the owner sees it: the crispness of type and edges is half of what the shots are for. */
const page = (viewport: { width: number; height: number }) => browser.newPage({ viewport, deviceScaleFactor: 2 })
const wanted = (name: string) => !only || only.some((w) => name.includes(w))

async function firstRunAs(page: Page, name: string) {
  await page.getByRole("textbox", { name: "Your name" }).fill(name)
  await page.getByRole("button", { name: "Continue" }).click()
  await page.getByRole("complementary").getByRole("button", { name: new RegExp(name, "i") }).first().waitFor()
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
  if (!wanted(name)) return
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
  const owner = await page(WIDE)
  owner.on("pageerror", (e) => console.log(`page error: ${e.message}`))
  await owner.goto(BASE)
  await firstRunAs(owner, "Jonatas")
  await passkey(owner)

  // New is the list's first row.
  const newChannel = owner.getByRole("complementary").getByRole("button", { name: "New channel", exact: true })
  await newChannel.click()
  await owner.getByRole("dialog").getByRole("textbox").fill("kiwi")
  await owner.getByRole("button", { name: "Create channel" }).click()
  await owner.waitForURL(/#mc2-/)
  const channel = owner.url()
  const code = decodeURIComponent(new URL(channel).hash.slice(1))

  const needs = owner.getByRole("region", { name: "Needs you" })
  /** An agent asks in; the owner compares its code under Needs you and lets it in. */
  const admit = async (args: string[]) => {
    console.log(`admitting ${args.join(" ")}`)
    const joining = kiwi(["join", code, ...args, "--relay", BASE], (o) => void (pendingOut = o))
    const letIn = needs.getByRole("button", { name: "It matches: let in" })
    const showCode = needs.getByRole("button", { name: "Show code" })
    const banner = needs.getByRole("button", { name: /needs? you/ }).first()
    await banner.waitFor({ timeout: 30000 })
    if ((await banner.getAttribute("aria-expanded")) !== "true") await banner.click()
    await letIn.or(showCode).first().waitFor({ timeout: 30000 })
    if (await showCode.count()) await showCode.click()
    await letIn.waitFor({ timeout: 30000 })
    // Each agent asks, so each one is there to shoot: don't seat the computer.
    const seat = needs.getByRole("checkbox", { name: /Let agents from .* in from now on/ })
    if (await seat.count()) await seat.uncheck()
    await letIn.click()
    await joining
  }
  await admit(["kiwi", "--as", "atlas", "--role", "backend", "--model", "claude-opus-5-5"])
  // atlas coordinates: people talk with it, and the channel is in coordinator mode from the start.
  const details = () => owner.getByRole("button", { name: /^Details:/ })
  await details().click()
  // The first agent in becomes the coordinator on its own; make sure it's atlas.
  await owner.getByText(/Coordinator mode: on/).first().waitFor({ timeout: 5000 }).catch(async () => {
    await owner.getByRole("button", { name: "More for atlas" }).click()
    await owner.getByRole("menuitem", { name: "Make coordinator" }).click()
    await owner.getByText(/Coordinator mode: on/).first().waitFor({ timeout: 15000 })
  })
  await owner.getByRole("button", { name: "Close details" }).click()
  await admit(["kiwi-w", "--as", "win", "--role", "frontend", "--model", "gpt-5-codex"])
  // The passkey offer waits for an agent's first card; save the channels to it, so the list stays quiet.
  const offer = owner.getByRole("button", { name: "Save channels to a passkey" })
  if (await offer.isVisible({ timeout: 5000 }).catch(() => false)) {
    await offer.click()
    const saving = owner.getByRole("dialog").filter({ hasText: "Save your recovery code" })
    await saving.waitFor()
    await saving.getByRole("checkbox").check()
    await saving.getByRole("button", { name: "Done" }).click()
    await saving.waitFor({ state: "hidden" })
  }

  // The main conversation: the person and the coordinator. A question, a thread, a long message with code.
  const composer = () => owner.getByRole("textbox", { name: "Message" })
  await composer().fill("Morning. The relay deploy is done; can someone check the Effect router numbers?")
  await owner.keyboard.press("Enter")
  await owner.waitForTimeout(400)
  await bot("send", "On it. I’ll have win run the steady load first, then the cold runs.")
  await bot("send", "Numbers are in:\n\n- p50 0.3ms, p95 1ms\n- no refusals in 800 rooms\n\nThe change is in `src/relay/route.ts`, one prebuilt program per request:\n\n```ts\nconst program = answer(dispatch(routes, guards, otherwise))\n```")
  await bot("ask", "--to", "jonatas", "Ship it as 0.8.12, or wait for the web?")
  // Work: each task has its own conversation, where the agents working it talk.
  const firstTask = /T(\d+)/.exec(await bot("task", "add", "Write fewer rows per message", "--owner", "win"))
  await bot("task", "add", "Polish the conversation feed")
  if (firstTask) {
    await win("send", "--re", firstTask[1]!, "Starting. Rows per message are 6 today; aiming for 4.")
    await bot("send", "--re", firstTask[1]!, "Keep the event rows; fold only the duplicates.")
    await win("send", "--re", firstTask[1]!, "Down from 6 to 4. https://github.com/ojowwalker77/channels/pull/41")
    await win("task", "start", `T${firstTask[1]}`, "steady numbers look fine")
  }
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
  // Work waiting on a person's review, and a decision an agent hands to its person: both under Needs you.
  const reviewed = /T\d+/.exec(await win("task", "add", "Cache sealed history in the browser", "--owner", "win", "--review", "any"))?.[0] ?? "T0"
  await win("task", "review", reviewed, "reload fetches only what is new")
  await win("escalate", "Should I delete the 800 test rooms on the old relay? It frees space, and it can't be undone.")
  // A direct conversation: the person and the coordinator, privately.
  await details().click()
  await owner.getByRole("button", { name: "More for atlas" }).click()
  await owner.getByRole("menuitem", { name: "Message privately" }).click()
  await composer().fill("Between us: is win overloaded? Tell me before you hand it more.")
  await owner.keyboard.press("Enter")
  await owner.waitForTimeout(400)
  await owner.goto(channel)

  // An agent asking to join, left pending (its CLI waits in the background).
  void kiwi(["join", code, "kiwi-2", "--relay", BASE, "--as", "scout", "--role", "frontend"], (o) => void (pendingOut = o)).catch(() => {})
  await needs.getByText(/scout/).first().waitFor({ timeout: 30000 }).catch(() => console.log(`no pending request to show: ${pendingOut.trim().split("\n").pop()}`))
  await owner.keyboard.press("Escape")

  // A second channel, still empty: it opens on how to add an agent.
  await newChannel.click()
  await owner.getByRole("dialog").getByRole("textbox").fill("fresh")
  await owner.getByRole("button", { name: "Create channel" }).click()
  await owner.waitForURL((u) => u.toString() !== channel && /#mc2-/.test(u.toString()))
  const fresh = owner.url()

  // ---------- shoot ----------
  for (const theme of (["dark", "light"] as const).filter((t) => !themeOnly || t === themeOnly)) {
    for (const [vp, size] of ([["wide", WIDE], ["narrow", NARROW]] as const).filter(([v]) => !wideOnly || v === "wide")) {
      const tag = `${theme}-${vp}`
      await owner.setViewportSize(size)
      await owner.goto(channel)
      await setTheme(owner, theme)
      await owner.getByText("Ship it as 0.8.12").first().waitFor({ timeout: 15000 }).catch(() => {})

      const narrow = vp === "narrow"
      const detailsBtn = () => owner.getByRole("button", { name: /^Details:/ })
      const convs = () => owner.getByRole("main").getByRole("navigation", { name: "Conversations" })
      const tasksBtn = () => owner.getByRole("main").getByRole("button", { name: "Tasks", exact: true })
      const overview = () => owner.getByRole("complementary", { name: "Overview" })
      const tasksPanel = () => owner.getByRole("complementary", { name: "Tasks" })
      const openOverview = async () => {
        if (await tasksPanel().count()) await tasksPanel().getByRole("button", { name: "Close tasks" }).click()
        await overview().waitFor()
      }
      const closeTasks = () => tasksPanel().getByRole("button", { name: "Close tasks" }).click()
      /** Back to main from a direct conversation: the name's capsule leads with the way back. */
      const toTop = async () => {
        await owner.getByRole("main").hover()
        await owner.mouse.wheel(0, -4000)
      }
      const toChannel = async () => {
        await owner.goto(channel)
        await toTop()
      }
      const toChat = async () => {
        const back = convs().getByRole("button", { name: "Back to chat" })
        if (await back.count()) await back.click()
      }
      /** A task opens in the Tasks panel, from its list. */
      const toTask = async (name: RegExp) => {
        if (!(await tasksPanel().count())) {
          if (narrow) await tasksBtn().click()
          else {
            await openOverview()
            await overview().getByRole("button", { name: "All tasks" }).click()
          }
        }
        await tasksPanel().getByRole("button", { name }).first().click()
      }
      await shoot(owner, tag, "01-channel")
      await owner.mouse.wheel(0, -4000)
      await shoot(owner, tag, "02-channel-top")
      await shoot(owner, tag, "03-thread", async () => {
        await owner.locator("button[aria-label='Reply']").last().dispatchEvent("click")
        await owner.getByRole("button", { name: "Close thread" }).waitFor()
      }, () => owner.getByRole("button", { name: "Close thread" }).click())
      await shoot(owner, tag, narrow ? "04-tasks" : "04-overview", narrow ? () => tasksBtn().click() : openOverview, narrow ? closeTasks : undefined)
      await shoot(owner, tag, "05-task-thread", () => toTask(/Write fewer rows/), async () => {})
      await shoot(owner, tag, "06-task-page", async () => {
        await tasksPanel().getByRole("region", { name: /^Task T\d+/ }).getByRole("button", { name: /^Activity/ }).click()
        await tasksPanel().getByRole("textbox", { name: /^Comment on T\d+/ }).waitFor()
      }, closeTasks)
      await shoot(owner, tag, "15-needs-you", async () => {
        await owner.getByRole("region", { name: "Needs you" }).getByRole("button", { name: /needs? you/ }).first().click()
      })
      await shoot(owner, tag, "07-details", () => detailsBtn().click(), () => owner.getByRole("button", { name: "Close details" }).click())
      await shoot(owner, tag, "08-direct", async () => {
        await detailsBtn().click()
        await owner.getByRole("button", { name: "More for atlas" }).click()
        await owner.getByRole("menuitem", { name: "Message privately" }).click()
        await convs().getByRole("button", { name: "Back to chat" }).waitFor()
      }, async () => {
        await toChat()
        await toTop()
      })
      await shoot(owner, tag, "09-invite", async () => {
        await detailsBtn().click()
        await owner.getByRole("button", { name: "Invite", exact: true }).click()
      }, async () => {
        await owner.keyboard.press("Escape")
        await owner.getByRole("button", { name: "Close details" }).click()
      })
      await shoot(owner, tag, "10-account-menu", async () => {
        if (narrow) await owner.getByRole("button", { name: "Channels" }).click()
        await owner.getByRole("complementary").getByRole("button", { name: /Jonatas/ }).click()
      }, async () => {
        await owner.keyboard.press("Escape")
        if (narrow) await toChannel()
      })
      await shoot(owner, tag, "11-palette", async () => {
        if (narrow) await owner.getByRole("button", { name: "Channels" }).click()
        await owner.keyboard.press("ControlOrMeta+k")
      }, async () => {
        await owner.keyboard.press("Escape")
        if (narrow) await toChannel()
      })
      await shoot(owner, tag, "12-notes", async () => {
        await detailsBtn().click()
        await owner.getByRole("button", { name: /^Notes/ }).click()
      }, () => owner.getByRole("button", { name: "Close details" }).click())
      await shoot(owner, tag, "13-pause", async () => {
        await detailsBtn().click()
        await owner.getByRole("complementary", { name: "Details" }).getByRole("button", { name: /^Pause (all )?agents$/ }).click()
      }, async () => {
        await owner.keyboard.press("Escape")
        await owner.getByRole("button", { name: "Close details" }).click()
      })
      await shoot(owner, tag, "14-list", async () => {
        if (narrow) await owner.getByRole("button", { name: "Channels" }).click()
      }, async () => {
        if (narrow) await owner.goto(channel)
      })
      await owner.goto(fresh)
      await owner.getByRole("region", { name: "Add an agent" }).waitFor({ timeout: 10000 }).catch(() => {})
      await shoot(owner, tag, "16-add-agent")

      // Signed out, and someone opening the invite link who isn't in yet.
      if (only && !["20-first-run", "21-join-with-code", "22-invite-preview", "23-signed-in-empty"].some(wanted)) continue
      const out = await page(size)
      await out.goto(BASE)
      await setTheme(out, theme)
      await shoot(out, tag, "20-first-run")
      await firstRunAs(out, "Pat").catch(() => {})
      await shoot(out, tag, "23-signed-in-empty")
      await shoot(out, tag, "21-join-with-code", async () => {
        await out.getByRole("complementary").getByRole("button", { name: "New channel", exact: true }).click()
        await out.getByRole("dialog").getByRole("button", { name: "Have a code? Join" }).click()
      })
      await out.goto(`${BASE}#${encodeURIComponent(code)}`)
      await out.getByRole("heading", { name: /invited you to a channel|You’re invited to a channel/ }).waitFor({ timeout: 10000 }).catch(() => {})
      await shoot(out, tag, "22-invite-preview")
      await out.close()
    }
  }
} catch (e) {
  // Where it stopped, for whoever reads the failure.
  for (const ctx of browser.contexts()) for (const [i, pg] of ctx.pages().entries()) await pg.screenshot({ path: join(OUT, `failed-${i}.png`) }).catch(() => {})
  console.log(`last CLI output: ${pendingOut.trim().split("\n").slice(-3).join(" | ")}`)
  throw e
} finally {
  await browser.close()
  for (const p of running) p.kill()
  relay.kill()
  rmSync(data, { recursive: true, force: true })
}
console.log(`\n${shots.length} screenshots in ${OUT}`)
