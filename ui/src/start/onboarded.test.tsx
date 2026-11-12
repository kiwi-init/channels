import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { ChannelTile } from "~/model"
import { AppContext, startNav, type Ctx } from "~/nav"
import { FirstRun } from "~/start/first-run"
import { onboarded, rememberOnboarded } from "~/start/onboarded"
import { Welcome } from "~/start/welcome"

const ONBOARDING = 'aria-label="Welcome to Channels"'

const kept = new Map<string, string>()
const storage = {
  getItem: (key: string): string | null => kept.get(key) ?? null,
  setItem: (key: string, value: string): void => void kept.set(key, value),
  removeItem: (key: string): void => void kept.delete(key),
  clear: (): void => kept.clear(),
}
const still = {
  matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
}

const tile = (code: string): ChannelTile => ({ code, title: `Channel ${code}`, state: "member", unread: 0, needsYou: 0, last: 0 })

const render = (page: ReactNode, app: { account: object | null; channels: ChannelTile[] }): string =>
  renderToStaticMarkup(
    <AppContext.Provider value={{ app: { home: [], signIn: null, enrolling: null, actions: {}, prefs: { reduceMotion: true }, ...app }, nav: startNav(null), go: () => {} } as unknown as Ctx}>
      {page}
    </AppContext.Provider>
  )

const newPerson = (): string => render(<FirstRun />, { account: null, channels: [] })
const noChannels = (): string => render(<Welcome />, { account: { name: "maya" }, channels: [] })
const withChannels = (): string => render(<Welcome />, { account: { name: "maya" }, channels: [tile("c1")] })

const before = { window: globalThis.window, localStorage: globalThis.localStorage }

beforeAll(() => {
  Object.assign(globalThis, { window: still, localStorage: storage })
})

afterAll(() => {
  Object.assign(globalThis, before)
})

beforeEach(() => kept.clear())

describe("the onboarding shows only on a computer that hasn't finished it, while the person has no channels (#5918)", () => {
  test("a new person on an unfinished computer sees it over the name step", () => {
    const html = newPerson()
    expect(html).toContain(ONBOARDING)
    expect(html).toContain('aria-label="Your name"')
  })

  test("an existing account with no channels on an unfinished computer sees it over the empty home", () => {
    const html = noChannels()
    expect(html).toContain(ONBOARDING)
    expect(html).toContain("No channels yet")
  })

  test("an account with channels never sees it", () => {
    const html = withChannels()
    expect(html).not.toContain(ONBOARDING)
    expect(html).toContain("Channel c1")
  })

  test("a computer that finished it never shows it again, signed out or with no channels", () => {
    rememberOnboarded()
    expect(kept.get("ui.onboarded")).toBe("1")
    expect(newPerson()).not.toContain(ONBOARDING)
    expect(noChannels()).not.toContain(ONBOARDING)
  })

  test("the home with channels marks the computer done, so leaving every channel doesn't bring it back", () => {
    expect(onboarded(false)).toBe(false)
    expect(onboarded(true)).toBe(true)
    expect(kept.get("ui.onboarded")).toBe("1")
    expect(noChannels()).not.toContain(ONBOARDING)
  })
})
