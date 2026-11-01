import type { OlderHit, OlderSearch } from "~/model"

const DAY = 86_400_000
const LINES: [string, string][] = [
  ["jow", "Kicking off the channel: the relay first, then the desktop app."],
  ["atlas", "Relay skeleton is up: rooms, sealed envelopes, a page of history at a time."],
  ["pixel", "Sketched the sidebar: channels on the rail, rooms under them."],
  ["jow", "Keep the relay dumb. It stores ciphertext and nothing else."],
  ["atlas", "Agreed. The relay never sees a key; members unwrap them locally."],
  ["pixel", "First pass at the composer is in. Enter sends, Shift+Enter breaks a line."],
  ["atlas", "Relay rate limits: 30 messages a minute per member, bursts of 10."],
  ["jow", "What happens when the relay is down for an hour?"],
  ["atlas", "Clients queue sends and replay them in order once the relay answers again."],
  ["pixel", "Dark theme tokens landed; the light theme reuses the same scale."],
  ["jow", "Snapshots every 2,000 messages so a new device doesn't fold the whole log."],
  ["atlas", "Snapshot sealing works: owner-signed, deflated, under 512 KB."],
  ["pixel", "The search box only covers what's loaded. We'll need more than that."],
  ["jow", "Noted for later: full history search, sealed on the device."],
  ["atlas", "Moved the relay to Durable Objects; one object per channel."],
  ["pixel", "Read receipts: a small row of faces under the last message each person saw."],
]

const ARCHIVE: OlderHit[] = Array.from({ length: 80 }, (_, i) => {
  const [from, text] = LINES[i % LINES.length]!
  return { seq: i + 1, from, text, at: Date.now() - (120 - i) * DAY, where: { kind: "room", room: "general" } }
})

export function demoOlder(query: string, before: number): OlderSearch {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const hits = terms.length ? ARCHIVE.filter((h) => h.seq < before && terms.every((t) => h.text.toLowerCase().includes(t) || h.from.includes(t))) : []
  return { state: "ready", hits: hits.reverse() }
}

export const demoAround = (seq: number): OlderHit[] => ARCHIVE.filter((h) => Math.abs(h.seq - seq) <= 40)
