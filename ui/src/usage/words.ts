import type { Usage } from "~/model"

export type Level = "calm" | "near" | "full"

const NEAR = 0.8

export const shareOf = (u: Usage): number => (u.limit ? Math.min(1, u.used / u.limit) : 0)

export function levelOf(u: Usage): Level {
  if (u.limit === null) return "calm"
  if (u.used >= u.limit) return "full"
  return u.used >= u.limit * NEAR ? "near" : "calm"
}

export function resetsIn(resetsAt: number, now: number): string {
  const minutes = Math.max(1, Math.round((resetsAt - now) / 60_000))
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

export const count = (n: number): string => n.toLocaleString("en-US")

export const unlimitedNow = (u: Usage): boolean => u.plan === "paid" && levelOf(u) === "calm"

export const usedOf = (u: Usage): string => (u.limit === null ? `${count(u.used)} today` : `${count(Math.min(u.used, u.limit))} of ${count(u.limit)}`)

export const meterTitle = (u: Usage): string => (u.plan === "paid" ? "Fair-use limit today" : "Messages today")

const PLAN: Record<Usage["plan"], string> = { free: "Free", paid: "Unlimited", unlimited: "Unlimited" }

export const planName = (u: Usage): string => PLAN[u.plan]

export const upgradeLabel = (u: Usage): string => (u.paidLimit ? "Get unlimited" : "Upgrade")

export const canUpgrade = (u: Usage): boolean => u.plan === "free" && !!u.upgradeUrl

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)
