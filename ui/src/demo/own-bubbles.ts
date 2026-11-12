import type { Channel, Message } from "~/model"
import { wrote } from "~/words"

const general = { kind: "room", room: "general" } as const

const WIDE_SHOT = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750"><rect width="1200" height="750" fill="#18181b"/><rect x="300" y="150" width="600" height="450" rx="36" fill="#212125"/><rect x="360" y="225" width="300" height="30" rx="15" fill="#ececef"/><rect x="360" y="300" width="480" height="60" rx="18" fill="#111113"/><rect x="360" y="405" width="480" height="135" rx="18" fill="#111113"/></svg>`
)}`

export function withOwnBubbles(c: Channel): Channel {
  const now = Date.now()
  const m = (min: number) => now - min * 60_000
  const first = Math.max(...c.messages.map((x) => x.seq)) + 1
  const rows: Omit<Message, "seq" | "where">[] = [
    { from: "atlas", at: m(58), text: wrote("Morning. The board is empty, what goes on it first?") },
    { from: "jow", at: m(50), text: wrote("The modal one.") },
    { from: "atlas", at: m(49), text: wrote("Which modal, Add an agent?") },
    {
      from: "jow",
      at: m(40),
      text: wrote("Yes. It flickers sometimes while I type the name, and the command box under it jumps @atlas"),
      images: [{ url: WIDE_SHOT, width: 1200, height: 750, alt: "add-an-agent.png" }],
    },
    { from: "jow", at: m(39), text: wrote("Then go through the issues I opened and put every one of them on the board") },
    { from: "jow", at: m(38), text: wrote("The tabs come after that") },
    { from: "win", at: m(30), text: wrote("The spec for the flicker is ready for you. Once you approve it, I take it.") },
    {
      from: "jow",
      at: m(22),
      text: wrote(
        "The lead should handle all of this, and the other roles should do one thing each. Just build, just review, and the lead keeps the rest together.\n\nI want to see how the tasks are going and talk to the lead and the rooms. A question with buttons is fine, but thirty of them in one day is far too many, so batch them and send me one per area with what we already decided, and I never answer the same thing twice."
      ),
    },
    { from: "win", at: m(15), text: wrote("The hover tools show on the whole line today. Is that the one you mean?") },
    { from: "atlas", at: m(14), text: wrote("Understood. Builders bring me decisions with the evidence and I batch them for you.") },
    { from: "jow", at: m(8), text: wrote("Yes, the tools should show only when the pointer is over the message itself, not the whole line"), replyTo: first + 8 },
    {
      from: "jow",
      at: m(2),
      text: wrote("Approved. Ship it once CI is green"),
      task: 12,
      reactions: [
        { emoji: "👍", by: ["atlas", "win"] },
        { emoji: "🔥", by: ["jow"] },
      ],
      thread: { replies: 2, last: m(1), people: ["atlas", "win"] },
    },
  ]
  const messages: Message[] = rows.map((r, i) => ({ ...r, seq: first + i, where: general }))
  return { ...c, messages: [...c.messages.filter((x) => x.where.kind !== "room" || x.where.room !== "general"), ...messages] }
}
