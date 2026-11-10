import type { Channel } from "~/model"
import { seatRoot } from "~/names"
import type { Go } from "~/nav"

export function personGo(channel: Pick<Channel, "people" | "you">, name: string): Go {
  const root = seatRoot(channel, name)
  if (root === channel.you || root === seatRoot(channel, channel.you)) return { to: "modal", modal: { kind: "person", name } }
  return { to: "where", where: { kind: "dm", with: root } }
}
