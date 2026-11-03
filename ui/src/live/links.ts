import type { Channel } from "~/model"

export function drawerNews(channel: Pick<Channel, "rooms" | "directs">): "loud" | "quiet" | null {
  if (channel.rooms.some((r) => r.mentions > 0) || channel.directs.some((d) => d.unread > 0)) return "loud"
  return channel.rooms.some((r) => r.unread > 0) ? "quiet" : null
}

export function messageOfLink(url: string): number | null {
  const found = /[?&]m=(\d{1,15})(?:[&#]|$)/.exec(url)
  const seq = found ? Number(found[1]) : Number.NaN
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null
}

export function hashTarget(hash: string): { hash: string; seq: number | null } {
  const at = hash.indexOf("?")
  return at < 0 ? { hash, seq: null } : { hash: hash.slice(0, at), seq: messageOfLink(hash.slice(at)) }
}
