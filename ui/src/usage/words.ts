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
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

export const count = (n: number): string => n.toLocaleString("en-US")

export const usedOf = (u: Usage): string => (u.limit === null ? `${count(u.used)} today` : `${count(Math.min(u.used, u.limit))} of ${count(u.limit)}`)

const isFairUse = (limit: number | null | undefined): boolean => !!limit && limit >= FAIR_USE

export const fairUse = (u: Usage): boolean => u.plan === "paid" && isFairUse(u.limit)

export const seemsUnlimited = (u: Usage): boolean => fairUse(u) && levelOf(u) === "calm"

const PLAN: Record<Usage["plan"], string> = { free: "Free", paid: "Paid", unlimited: "Unlimited" }

export const planName = (u: Usage): string => (fairUse(u) ? "Unlimited" : PLAN[u.plan])

export function upgradeLabel(u: Usage): string {
  if (isFairUse(u.paidLimit)) return "Get unlimited"
  return u.paidLimit ? `Get ${count(u.paidLimit)} a day` : "Upgrade"
}

export function paidPlanLine(u: Usage): string | null {
  if (isFairUse(u.paidLimit)) return "The paid plan is unlimited."
  return u.paidLimit ? `The paid plan sends ${count(u.paidLimit)} messages a day.` : null
}

export function planHint(u: Usage): string {
  if (u.plan === "unlimited") return "No daily limit on this relay."
  if (seemsUnlimited(u)) return "No daily limit."
  if (fairUse(u)) return `A fair-use limit of ${count(u.limit ?? 0)} messages a day.`
  const a = u.limit === null ? "No daily limit" : `${count(u.limit)} messages a day`
  const paid = u.plan === "free" ? paidPlanLine(u) : null
  return paid ? `${a}. ${paid}` : `${a}.`
}

export const usageHint = (u: Usage, resets: string): string =>
  fairUse(u) ? `The paid plan's fair-use limit, agents' included. Resets in ${resets}.` : `In the channels you own, agents' included. Resets in ${resets}.`

export const canUpgrade = (u: Usage): boolean => u.plan === "free" && !!u.upgradeUrl

export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10)
