import { describe, expect, test } from "bun:test"

import { dailyLimit } from "~/live/refused"
import type { Usage } from "~/model"
import { canUpgrade, levelOf, paidPlanLine, planHint, planName, resetsIn, seemsUnlimited, shareOf, upgradeLabel, usageHint, usedOf } from "~/usage/words"

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

  test("only a free person with an upgrade link is offered the paid plan, named by its limit", () => {
    expect(canUpgrade(free)).toBe(true)
    expect(upgradeLabel(free)).toBe("Get 5,000 a day")
    expect(upgradeLabel({ ...free, paidLimit: null })).toBe("Upgrade")
    expect(canUpgrade({ ...free, plan: "paid" })).toBe(false)
    expect(canUpgrade({ ...free, upgradeUrl: null })).toBe(false)
  })

  test("a paid plan of 100,000 a day or more reads as unlimited; its cap shows only from 80%, as a fair-use limit (#659)", () => {
    const paid: Usage = { ...free, plan: "paid", used: 3120, limit: 100_000, paidLimit: 100_000, upgradeUrl: null }
    expect(upgradeLabel({ ...free, paidLimit: 100_000 })).toBe("Get unlimited")
    expect(paidPlanLine({ ...free, paidLimit: 100_000 })).toBe("The paid plan is unlimited.")
    expect(planHint({ ...free, paidLimit: 100_000 })).toBe("1,000 messages a day. The paid plan is unlimited.")
    expect(planName(paid)).toBe("Unlimited")
    expect(seemsUnlimited(paid)).toBe(true)
    expect(planHint(paid)).toBe("No daily limit.")
    const near = { ...paid, used: 86_420 }
    expect(seemsUnlimited(near)).toBe(false)
    expect(usedOf(near)).toBe("86,420 of 100,000")
    expect(planHint(near)).toBe("A fair-use limit of 100,000 messages a day.")
    expect(usageHint(near, "5h")).toBe("The paid plan's fair-use limit, agents' included. Resets in 5h.")
    expect(planName({ ...paid, limit: 5000 })).toBe("Paid")
    expect(planHint({ ...free, paidLimit: 5000 })).toBe("1,000 messages a day. The paid plan sends 5,000 messages a day.")
  })

  test("the relay's daily-limit refusal opens the dialog; a per-minute rate limit doesn't", () => {
    const relay = (tag: string, message: string) => Object.assign(new Error(message), { _tag: "RelayError", tag })
    expect(dailyLimit(relay("TooMany", "this channel's owner has used today's 1,000 messages; more can be sent after 00:00 UTC (in 5h)"))).toBe(true)
    expect(dailyLimit(relay("TooMany", "too many messages; wait a minute"))).toBe(false)
    expect(dailyLimit(relay("Forbidden", "today's 1,000 messages"))).toBe(false)
    expect(dailyLimit(new Error("today's 1,000 messages"))).toBe(false)
  })
})
