import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { ChannelTile, HomeAgent, HomeChannel, Person } from "~/model"
import { AppContext, startNav, type Ctx } from "~/nav"
import { Welcome } from "~/start/welcome"

const tile = (code: string, title: string, needsYou = 0): ChannelTile => ({ code, title, state: "member", unread: 0, needsYou, last: 0 })

const agent = (name: string, state: HomeAgent["state"], task: string | null): HomeAgent => ({
  name,
  nick: name,
  person: { name, kind: "agent", owner: false, you: false, presence: state === "away" ? "offline" : "online", harness: "claude" } as Person,
  state,
  doing: state === "working" ? "thinking" : state,
  task: task ? { id: 1, title: task } : null,
})

const home = (code: string, title: string, more: Partial<HomeChannel> = {}): HomeChannel => ({
  code,
  title,
  lead: null,
  leadName: null,
  working: 0,
  asks: [],
  moving: [],
  more: 0,
  doneToday: 0,
  red: 0,
  agents: [],
  said: null,
  ...more,
})

const LONG_A = "A: Bench test: sheet generator + reader on the phone, 3 printed densities"
const LONG_B = "B: Straight to print with the densest layout"

const page = (): string =>
  renderToStaticMarkup(
    <AppContext.Provider
      value={
        {
          app: {
            channels: [tile("launch", "channels-launch"), tile("reedy", "Reedy"), tile("notes", "kiwinotes"), tile("omni", "OmniRad", 1)],
            home: [
              home("launch", "channels-launch", {
                doneToday: 5,
                agents: [agent("builder-one", "working", "Shots: onboarding check"), agent("builder-three", "working", null), agent("ivy", "idle", null)],
              }),
              home("reedy", "Reedy"),
              home("notes", "kiwinotes", { agents: [agent("megabrain", "away", null)] }),
              home("omni", "OmniRad", {
                agents: [agent("hyper", "away", null)],
                asks: [{ id: "q", at: 0, what: "hyper asks", text: "Bench test or print?", act: { kind: "options", options: [LONG_A, LONG_B].map((o) => ({ shown: o, answer: o })) } }],
              }),
            ],
            actions: {},
            prefs: { reduceMotion: true },
          },
          nav: startNav(null),
          go: () => {},
        } as unknown as Ctx
      }
    >
      <Welcome />
    </AppContext.Provider>
  )

const before = { window: globalThis.window, localStorage: globalThis.localStorage }

beforeAll(() => {
  const kept = new Map<string, string>()
  Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) },
    localStorage: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) },
  })
})

afterAll(() => {
  Object.assign(globalThis, before)
})

describe("Home, polished (#509)", () => {
  test("a question's answers are buttons in their own row under it, each one whole", () => {
    const html = page()
    expect(html).toContain('class="calm-ask has-options"')
    expect(html).toContain(`<button type="button" class="calm-opt">${LONG_A}</button>`)
    expect(html).toContain(`<button type="button" class="calm-opt">${LONG_B}</button>`)
  })

  test("an agent row has a face and its task, and says working only when there's no task to show", () => {
    const html = page()
    expect(html).not.toContain(">thinking")
    expect(html.match(/class="calm-agent-state">working</g)?.length).toBe(1)
    expect(html).toContain("Shots: onboarding check")
    expect(html.match(/class="calm-agent is-working"[^>]*><span class="av av-sm/g)?.length).toBe(2)
  })

  test("quiet channels fold into one list, the one that needs you first, each on one row", () => {
    const html = page()
    const quiet = html.slice(html.indexOf('aria-label="Quiet channels"'))
    expect(quiet.indexOf("OmniRad")).toBeLessThan(quiet.indexOf("Reedy"))
    expect(quiet).toContain("1 needs you")
    expect(quiet).toContain("megabrain away")
    expect(html.match(/class="calm-quiet"/g)?.length).toBe(3)
    expect(html).not.toContain(">quiet<")
  })
})
