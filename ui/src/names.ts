import type { Channel, Person } from "~/model"

export const nicknamesOf = (members: Iterable<{ name: string; display?: string | undefined }>): ReadonlyMap<string, string> => new Map([...members].map((m) => [m.name, m.display || m.name]))

export const nickname = (channel: Pick<Channel, "nicknames">, handle: string): string => channel.nicknames.get(handle) ?? handle

export const between = (channel: Pick<Channel, "nicknames">, names: readonly [string, string]): string => `${nickname(channel, names[0])} & ${nickname(channel, names[1])}`

export const shown = (person: { name: string; display?: string | undefined }): string => person.display || person.name

export const seatRoot = (channel: Pick<Channel, "people">, name: string): string => channel.people.find((p) => p.name === name)?.seatOf ?? name

export const roomPeople = (channel: Pick<Channel, "people" | "you">): Person[] => {
  const mine = seatRoot(channel, channel.you)
  return channel.people.filter((p) => !p.you && !p.left && !p.seatOf && p.name !== mine)
}
