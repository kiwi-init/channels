import type { Channel, Message, Person } from "~/model"
import { wrote } from "~/words"

const general = { kind: "room", room: "general" } as const

const GONE = new Set(["pixel", "nova"])

function asleep(p: Person): Person {
  if (!GONE.has(p.name)) return p
  const gone: Person = { ...p, presence: "offline" }
  delete gone.activity
  delete gone.reach
  return gone
}

export function withSigns(c: Channel): Channel {
  const now = Date.now()
  const m = (min: number) => now - min * 60_000
  const first = Math.max(...c.messages.map((x) => x.seq)) + 1
  const rows: Omit<Message, "seq" | "where">[] = [
    { from: "jow", at: m(34), text: wrote("@atlas can you look at the scroll bug?"), receipt: "atlas is on it · thinking 1m", canChange: true },
    { from: "atlas", at: m(31), text: wrote("Looking now. I have it on a long channel with a late image.") },
    {
      from: "jow",
      at: m(21),
      text: wrote("@win is the bubble in my app?"),
      receipt: "win is busy on T10 · 3 messages ahead of yours",
      sign: { ask: { to: "atlas", name: "atlas", about: "win" } },
      canChange: true,
    },
    { from: "atlas", at: m(18), text: wrote("Scroll bug: reproduced, the fix is on the board as T14.") },
    { from: "jow", at: m(9), text: wrote("@pixel any news on the tabs?"), sign: { gone: "pixel can't be woken" }, canChange: true },
    { from: "atlas", at: m(7), text: wrote("T14 is in review.") },
    { from: "jow", at: m(2), text: wrote("@nova and the release notes?"), sign: { gone: "nova isn't listening" }, canChange: true },
  ]
  const messages: Message[] = rows.map((r, i) => ({ ...r, seq: first + i, where: general }))
  return { ...c, people: c.people.map(asleep), messages: [...c.messages.filter((x) => x.where.kind !== "room" || x.where.room !== "general"), ...messages] }
}
