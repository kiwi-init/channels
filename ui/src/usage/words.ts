import { span, t } from "~/i18n/i18n"
import type { Usage } from "~/model"

export type Level = "calm" | "near" | "full"

const NEAR = 0.8
const FAIR_USE = 100_000

export const shareOf = (u: Usage): number => (u.limit ? Math.min(1, u.used / u.limit) : 0)

export function levelOf(u: Usage): Level {
  if (u.limit === null) return "calm"
  if (u.used >= u.limit) return "full"
  return u.used >= u.limit * NEAR ? "near" : "calm"
}

export function resetsIn(resetsAt: number, now: number): string {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  return minutes < 60 ? span(minutes, "minute") : span(Math.round(minutes / 60), "hour")
}


export const usedOf = (u: Usage): string => (u.limit === null ? t("usage.used.today", { used: u.used }) : t("usage.used.of", { used: Math.min(u.used, u.limit), limit: u.limit }))

const isFairUse = (limit: number | null | undefined): boolean => !!limit && limit >= FAIR_USE

export const fairUse = (u: Usage): boolean => u.plan === "paid" && isFairUse(u.limit)

export const seemsUnlimited = (u: Usage): boolean => fairUse(u) && levelOf(u) === "calm"

const PLAN = { free: "usage.plan.free", paid: "usage.plan.paid", unlimited: "usage.plan.unlimited" } as const satisfies Record<Usage["plan"], string>

export const planName = (u: Usage): string => t(fairUse(u) ? "usage.plan.unlimited" : PLAN[u.plan])

export function upgradeLabel(u: Usage): string {
  if (isFairUse(u.paidLimit)) return t("usage.get.unlimited")
  return u.paidLimit ? t("usage.get.per.day", { count: u.paidLimit }) : t("usage.upgrade")
}

export function paidPlanLine(u: Usage): string | null {
  if (isFairUse(u.paidLimit)) return t("usage.paid.unlimited")
  return u.paidLimit ? t("usage.paid.sends", { count: u.paidLimit }) : null
}

export function planHint(u: Usage): string {
  if (u.plan === "unlimited") return t("usage.relay.no.limit")
  if (seemsUnlimited(u)) return t("usage.no.limit")
  if (fairUse(u)) return t("usage.fair.use", { count: u.limit ?? 0 })
  const first = u.limit === null ? t("usage.no.limit") : t("usage.per.day", { count: u.limit })
  const second = u.plan === "free" ? paidPlanLine(u) : null
  return second ? t("usage.two.sentences", { first, second }) : first
}

export const usageHint = (u: Usage, resets: string): string => t(fairUse(u) ? "usage.hint.fair.use" : "usage.hint", { time: resets })

export const canUpgrade = (u: Usage): boolean => u.plan === "free" && !!u.upgradeUrl

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)
