import { useEffect, useSyncExternalStore } from "react"

import type { ComputerSettings, SeatWake } from "@kiwi/core/computer-settings.ts"
import type { HookHarness, HookRow, HookState } from "@kiwi/core/harnesses.ts"
import type { UpChoices, UpOutcome, UpPick } from "@kiwi/core/up-outcome.ts"
import { harnessName } from "@kiwi/app/harness.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { store } from "~/live/value"
import type { BackRun, Finding, ThisComputer } from "~/model"

const computer = store<ThisComputer | null>(null)
const lastRun = store<BackRun>({ at: "idle" })

const shown = (rows: HookRow[]): ThisComputer["hooks"] =>
  rows.filter((r): r is HookRow & { state: Exclude<HookState, "absent"> } => r.state !== "absent").map((r) => ({ harness: r.harness, label: harnessName(r.harness), state: r.state }))

function need() {
  const b = bridge()
  if (!b) throw new Error(t("live.computer.desktop.only"))
  return b
}

export const computerNow = computer.get

export async function loadComputer(): Promise<void> {
  const b = bridge()
  if (!b) return
  const [daemon, hooks, line] = await Promise.all([b.daemonStatus(), b.hooks().catch((): HookRow[] => []), b.contextLine().catch(() => null)])
  computer.set({
    kiwi: { running: daemon.running, ...(daemon.version ? { version: daemon.version } : {}) },
    hooks: shown(hooks),
    contextLine: line === null ? null : line === "on",
    back: backPrompt(plan.get()),
    pick: canPickBack(),
    run: lastRun.get(),
  })
}

function setRun(run: BackRun): void {
  lastRun.set(run)
  const now = computer.get()
  if (now) computer.set({ ...now, run })
}

export function useComputer(): ThisComputer | null {
  useEffect(() => void loadUpPlan().catch(() => {}), [])
  useEffect(() => {
    const again = () => void loadComputer().catch(() => {})
    again()
    window.addEventListener("focus", again)
    return () => window.removeEventListener("focus", again)
  }, [])
  return useSyncExternalStore(computer.subscribe, computer.get)
}

export async function setHooks(harness: HookHarness, on: boolean): Promise<void> {
  const hooks = shown(await need().setHooks(harness, on ? "on" : "off"))
  const now = computer.get()
  if (now) computer.set({ ...now, hooks })
}

export const checkComputer = (): Promise<Finding[] | null> => need().doctor()

const plan = store<UpOutcome[] | null>(null)

export const upPlanNow = plan.get

export async function loadUpPlan(): Promise<void> {
  const b = bridge()
  if (!b) return
  plan.set(await b.upPlan().catch(() => null))
  const now = computer.get()
  if (now) computer.set({ ...now, back: backPrompt(plan.get()) })
}

async function runBack(call: () => Promise<UpOutcome[] | null>): Promise<BackRun> {
  setRun({ at: "working" })
  const outcomes = await call().catch(() => null)
  const run: BackRun = outcomes ? { at: "done", outcomes } : { at: "no.answer" }
  setRun(run)
  await loadUpPlan().catch(() => {})
  return run
}

export async function bringAgentsBack(): Promise<BackRun> {
  const b = need()
  return runBack(() => b.bringBack())
}

export function canPickBack(): boolean {
  const b = bridge()
  return !!b && typeof b.upChoices === "function" && typeof b.bringBackOnly === "function"
}

export async function backChoices(): Promise<UpChoices> {
  const got = await need().upChoices()
  if (!got) throw new Error(t("live.computer.back.no.plan"))
  return got
}

export async function bringPickedBack(picks: readonly UpPick[]): Promise<BackRun> {
  if (!picks.length) return lastRun.get()
  const b = need()
  return runBack(() => b.bringBackOnly(picks.map((p) => ({ channel: p.channel, handle: p.handle }))))
}

export type BackPrompt = NonNullable<ThisComputer["back"]>

const APART = new Set(["unsupported", "unverified", "unknown"])

export function backPrompt(seats: readonly UpOutcome[] | null): BackPrompt | null {
  const before = (seats ?? []).filter((s) => s.before)
  const down = before.filter((s) => s.result === "planned")
  return down.length ? { down, apart: before.filter((s) => s.result === "skipped" && !!s.skip && APART.has(s.skip)) } : null
}

export async function setContextLine(on: boolean): Promise<void> {
  const got = await need().setContextLine(on ? "on" : "off")
  if (!got) throw new Error(t("live.computer.not.changed"))
  const now = computer.get()
  if (now) computer.set({ ...now, contextLine: got === "on" })
}

const HOOK: Record<Exclude<HookState, "absent">, Key> = {
  installed: "live.computer.hook.installed",
  partial: "live.computer.hook.partial",
  outdated: "live.computer.hook.outdated",
  missing: "live.computer.hook.missing",
  off: "live.computer.hook.off",
}
const WAKE: Record<SeatWake, Key> = { on: "live.computer.wake.on", off: "live.computer.wake.off", webhook: "live.computer.wake.webhook" }

function settingsLines(s: ComputerSettings): [string, string[]][] {
  const hooks = s.hooks.flatMap((h) => (h.state === "absent" ? [] : [t("live.computer.hook.line", { harness: harnessName(h.harness), state: t(HOOK[h.state]) })]))
  return [
    [t("live.computer.hooks"), hooks.length ? hooks : [t("live.computer.none")]],
    [
      t("live.computer.agents"),
      s.seats.length ? s.seats.map((seat) => t("live.computer.seat", { agent: seat.agent, channel: seat.channel, wake: t(WAKE[seat.wake]) })) : [t("live.computer.none.yet")],
    ],
  ]
}

export async function computerSettings(id: string): Promise<[string, string[]][]> {
  const got = await need().settingsOn(id)
  if (!got.ok) throw Object.assign(new Error(got.detail), got.why ? { why: got.why } : {})
  return settingsLines(got.value)
}
