import type { Channel, ChannelTile, Person } from "~/model"
import { nicknamesOf } from "~/names"
import { DEMO_CHANNEL, DEMO_EMPTY } from "~/demo/data"
import { wrote } from "~/words"

const now = Date.now()
const m = (min: number): number => now - min * 60_000

const jow = DEMO_EMPTY.people[0] as Person

const away = (name: string, harness: Person["harness"]): Person => ({
  name,
  kind: "agent",
  owner: false,
  you: false,
  presence: "offline",
  harness,
  lastSeen: m(60 * 20),
  joined: m(60 * 24 * 12),
  messages: 90,
})

const quiet = (code: string, title: string, people: Person[], more: Partial<Channel> = {}): Channel => ({
  ...DEMO_EMPTY,
  code,
  title,
  people,
  nicknames: nicknamesOf(people),
  ...more,
})

const hyper = away("hyper", "claude")

export const CALM_CHANNELS: Channel[] = [
  { ...DEMO_CHANNEL, asks: [] },
  quiet("reedy", "Reedy", [jow]),
  quiet("kiwinotes", "kiwinotes", [jow, away("megabrain", "codex")]),
  quiet("omnirad", "OmniRad", [jow, hyper], {
    asks: [
      {
        kind: "question",
        id: "q-bench",
        from: "hyper",
        at: m(60 * 48),
        text: wrote(
          "The whole exam on one sheet: do we run a bench test to measure the reading first, or go straight to the printed version? The bench test tells us which density the phone reads reliably before we print 500 sheets."
        ),
        label: "Taste call for you",
        options: ["A: Bench test: sheet generator + reader on the phone, 3 printed densities, the answer key on the back", "B: Straight to print with the densest layout (paper only)"].map(wrote),
        holds: [],
      },
    ],
  }),
]

export const CALM_TILES: ChannelTile[] = [
  { code: "kiwi", title: "kiwi", state: "member", unread: 0, needsYou: 0, last: m(1) },
  { code: "reedy", title: "Reedy", state: "member", unread: 0, needsYou: 0, last: m(60 * 30) },
  { code: "kiwinotes", title: "kiwinotes", state: "member", unread: 0, needsYou: 0, last: m(60 * 50) },
  { code: "omnirad", title: "OmniRad", state: "member", unread: 0, needsYou: 1, last: m(60 * 48) },
]
