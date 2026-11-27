import { omit } from "@kiwi/core/omit.ts"
import type { Channel, Person } from "~/model"

const onDuty = (p: Person): Person =>
  p.name === "nova" ? { ...p, role: "lead", duty: "on" } : p.name === "atlas" ? { ...omit(p, "role"), duty: "off" } : p.name === "win" ? { ...p, duty: "standby" } : p

export function withLeadDuty(channel: Channel): Channel {
  return { ...channel, lead: "nova", people: channel.people.map(onDuty) }
}
