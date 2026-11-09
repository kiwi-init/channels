import type { Member as RosterMember } from "@kiwi/core/membership.ts"
import { cleanPersonalities } from "@kiwi/core/personalities.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import type { Event } from "@kiwi/core/protocol.ts"
import { fullyTrusted } from "@kiwi/core/state.ts"
import { secrets } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { openedRun, type Run } from "~/live/store"

export function need(code: string): Run {
  const run = openedRun(code)
  if (!run) throw new Error(t("live.run.open.first"))
  return run
}

export function owner(code: string): Run {
  const run = need(code)
  if (!run.isOwner) throw new Error(t("live.run.owner.only"))
  return run
}

export function memberOf(run: Run, name: string): RosterMember {
  const m = run.roster.find((r) => r.active && !r.unverified && r.name === name)
  if (!m) throw new Error(t("live.run.not.member", { name }))
  return m
}

export const event = (run: Run, body: string, ev: Event, to?: string[]) => run.send(body, { kind: "event", ev, ...(to?.length ? { to } : {}) })

export function personalities(): Personality[] {
  return [...PRESETS, ...cleanPersonalities(secrets().personalities)]
}

export function setup(code: string): Run {
  const run = need(code)
  if (!run.isOwner && !fullyTrusted(run.state.members.get(run.me))) throw new Error(t("live.run.setup.only"))
  return run
}

export const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function attempt(what: string, run: () => Promise<unknown>): void {
  void (async () => run())().catch((err: unknown) => announce(t("live.run.failed", { what, why: say(err) }), "error"))
}
