import { describe, expect, test } from "bun:test"

const saved = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => saved.get(k) ?? null,
    setItem: (k: string, v: string) => void saved.set(k, v),
    removeItem: (k: string) => void saved.delete(k),
  },
})

const { backDismissed, backHidden, dismissBack, savedBackDismissed } = await import("~/shell/back-dismissed")

const seat = (channel: string, handle: string) => ({ channel, handle })
const atlasNova = [seat("kiwi", "atlas"), seat("ops", "nova")]

describe("the agents-down card can be dismissed (#18120)", () => {
  test("a dismiss hides the card for that set of down agents", () => {
    expect(backHidden(atlasNova, backDismissed.get())).toBe(false)
    dismissBack(atlasNova)
    expect(backHidden(atlasNova, backDismissed.get())).toBe(true)
  })

  test("it stays hidden after a reload or restart, which reads it back from storage", () => {
    expect(backHidden(atlasNova, savedBackDismissed())).toBe(true)
  })

  test("the same agents in another order are the same set", () => {
    expect(backHidden([seat("ops", "nova"), seat("kiwi", "atlas")], savedBackDismissed())).toBe(true)
  })

  test("another agent down, or one back, shows it again", () => {
    expect(backHidden([...atlasNova, seat("kiwi", "sage")], savedBackDismissed())).toBe(false)
    expect(backHidden([seat("kiwi", "atlas")], savedBackDismissed())).toBe(false)
  })

  test("the same handle in another channel is another agent", () => {
    expect(backHidden([seat("kiwi", "atlas"), seat("kiwi", "nova")], savedBackDismissed())).toBe(false)
  })
})
