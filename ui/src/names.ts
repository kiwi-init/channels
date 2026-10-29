import type { Channel } from "~/model"

export const nicknamesOf = (members: Iterable<{ name: string; display?: string | undefined }>): ReadonlyMap<string, string> => new Map([...members].map((m) => [m.name, m.display || m.name]))

export const nickname = (channel: Pick<Channel, "nicknames">, handle: string): string => channel.nicknames.get(handle) ?? handle

export const between = (channel: Pick<Channel, "nicknames">, names: readonly [string, string]): string => `${nickname(channel, names[0])} & ${nickname(channel, names[1])}`

export const shown = (person: { name: string; display?: string | undefined }): string => person.display || person.name
