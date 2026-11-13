import "~/i18n/en/live-later"
import type { ComputerSettings, SeatWake } from "@kiwi/core/computer-settings.ts"
import type { HookHarness, HookState } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@kiwi/app/harness.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { computer, shown } from "~/live/computer"
import type { Finding } from "~/model"

function need() {
  const b = bridge()
  if (!b) throw new Error(t("live.computer.desktop.only"))
  return b
}

export async function setHooks(harness: HookHarness, on: boolean): Promise<void> {
  const hooks = shown(await need().setHooks(harness, on ? "on" : "off"))
  const now = computer.get()
  if (now) computer.set({ ...now, hooks })
}

export const checkComputer = (): Promise<Finding[] | null> => need().doctor()

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
