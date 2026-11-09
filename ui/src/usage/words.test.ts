import { describe, expect, test } from "bun:test"

import { dailyLimit } from "~/live/refused"
import type { Usage } from "~/model"
import { canUpgrade, levelOf, planName, resetsIn, shareOf, unlimitedNow, upgradeLabel, usedOf } from "~/usage/words"

const free: Usage = { plan: "free", blocked: false, used: 412, limit: 1000, channels: 2, resetsAt: 0, upgradeUrl: "https://pay.test", paidLimit: 5000, billingUrl: null }

describe("today's messages", () => {
  test("calm under 80%, near from 80%, full at the limit; the bar never passes full", () => {
    expect(levelOf(free)).toBe("calm")
    expect(levelOf({ ...free, used: 800 })).toBe("near")
    expect(levelOf({ ...free, used: 1000 })).toBe("full")
    expect(shareOf({ ...free, used: 1040 })).toBe(1)
    expect(usedOf({ ...free, used: 1040 })).toBe("1,000 of 1,000")
    expect(levelOf({ ...free, limit: null })).toBe("calm")
  })

  test("the reset reads in hours, or minutes in the last hour", () => {
    expect(resetsIn(5 * 3_600_000, 0)).toBe("5h")
    expect(resetsIn(40 * 60_000, 0)).toBe("40m")
    expect(resetsIn(0, 0)).toBe("1m")
  })

  test("only a free person with an upgrade link is offered the paid plan, as unlimited", () => {
    expect(canUpgrade(free)).toBe(true)
    expect(upgradeLabel(free)).toBe("Get unlimited")
    expect(upgradeLabel({ ...free, paidLimit: null })).toBe("Upgrade")
    expect(canUpgrade({ ...free, plan: "paid" })).toBe(false)
    expect(canUpgrade({ ...free, upgradeUrl: null })).toBe(false)
  })

  test("a paid person reads Unlimited with no count, until 80% of the fair-use cap (#659)", () => {
    const paid: Usage = { ...free, plan: "paid", used: 4120, limit: 100_000, upgradeUrl: null }
    expect(planName(paid)).toBe("Unlimited")
    expect(unlimitedNow(paid)).toBe(true)
    expect(unlimitedNow({ ...paid, used: 80_000 })).toBe(false)
    expect(usedOf({ ...paid, used: 86_400 })).toBe("fair-use limit: 86,400 of 100,000 today")
    expect(unlimitedNow(free)).toBe(false)
    expect(usedOf(free)).toBe("412 of 1,000")
  })

  test("the relay's daily-limit refusal opens the dialog; a per-minute rate limit doesn't", () => {
    const relay = (tag: string, message: string) => Object.assign(new Error(message), { _tag: "RelayError", tag })
    expect(dailyLimit(relay("TooMany", "this channel's owner has used today's 1,000 messages; more can be sent after 00:00 UTC (in 5h)"))).toBe(true)
    expect(dailyLimit(relay("TooMany", "too many messages; wait a minute"))).toBe(false)
    expect(dailyLimit(relay("Forbidden", "today's 1,000 messages"))).toBe(false)
    expect(dailyLimit(new Error("today's 1,000 messages"))).toBe(false)
  })
})
