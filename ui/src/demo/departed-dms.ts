import type { Channel } from "../model.ts"

export function withDepartedDms(c: Channel): Channel {
  const human = c.people.find((p) => p.kind === "human" && !p.you)
  if (!human) throw new Error("missing demo human")
  const names = ["departed-human", "scout", "unknown-person"]
  return {
    ...c,
    messages: [],
    former: [...(c.former ?? []), { ...human, name: "departed-human", display: "Mira", left: true, presence: "offline" }],
    nicknames: new Map([...c.nicknames, ["departed-human", "Mira"], ["unknown-person", "Unlisted"]]),
    directs: [...names.map((withName) => ({ with: withName, unread: 0, last: Date.now() })), ...c.directs.filter((d) => !names.includes(d.with))],
  }
}
