import type { App, Channel, Person, Where } from "~/model"
import type { Nav } from "~/nav"
import { nicknamesOf } from "~/names"
import { DEMO_AGENT_HANDLES } from "~/demo/handle-names"
import { Words, wordsRaw, wrote } from "~/words"

export const DEMO_HANDLES = new URLSearchParams(location.search).has("handles")

type Rename = (text: string) => string

function agentsOf(channel: Channel): string[] {
  return [...new Set([...channel.people, ...(channel.former ?? [])].filter((p) => p.kind === "agent").map((p) => p.name))]
}

function renamer(names: readonly string[]): Rename {
  const handles = new Map(names.map((name, i) => [name, DEMO_AGENT_HANDLES[i] ?? `agent-${i}-${name}`]))
  if (!handles.size) return (text) => text
  const mention = new RegExp(`(?<![\\w-])@(${[...handles.keys()].join("|")})(?![\\w-])`, "g")
  return (text) => handles.get(text) ?? text.replace(mention, (_whole, name: string) => `@${handles.get(name) ?? name}`)
}

function walk(value: unknown, rename: Rename): unknown {
  if (typeof value === "string") return rename(value)
  if (value instanceof Words) return wrote(rename(wordsRaw(value)))
  if (Array.isArray(value)) return value.map((v) => walk(v, rename))
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [walk(k, rename), walk(v, rename)]))
  if (value instanceof Set) return new Set([...value].map((v) => walk(v, rename)))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, rename)]))
}

const isChannel = (value: unknown, from: Channel): value is Channel =>
  typeof value === "object" && value !== null && "code" in value && value.code === from.code && "people" in value && Array.isArray(value.people) && value.people.length === from.people.length

const nicknamed = (person: Person, was: Person | undefined): Person => (was && person.kind === "agent" && person.name !== was.name ? { ...person, display: was.display || was.name } : person)

function renamed(channel: Channel): Channel {
  const walked = walk(channel, renamer(agentsOf(channel)))
  if (!isChannel(walked, channel)) return channel
  const people = walked.people.map((p, i) => nicknamed(p, channel.people[i]))
  const former = walked.former?.map((p, i) => nicknamed(p, channel.former?.[i]))
  const asks = walked.asks.map((a, i) => (a.kind === "join" ? (channel.asks[i] ?? a) : a))
  return { ...walked, people, asks, ...(former ? { former } : {}), nicknames: nicknamesOf([...people, ...(former ?? [])]) }
}

export function withDemoHandles(app: App): App {
  return app.channel ? { ...app, channel: renamed(app.channel) } : app
}

function whereRenamed(where: Where, rename: Rename): Where {
  switch (where.kind) {
    case "dm":
      return { kind: "dm", with: rename(where.with) }
    case "theirs":
      return { kind: "theirs", between: [rename(where.between[0]), rename(where.between[1])] }
    case "room":
    case "task":
      return where
  }
}

export function navWithDemoHandles(nav: Nav, app: App): Nav {
  if (!app.channel) return nav
  const rename = renamer(agentsOf(app.channel))
  return {
    ...nav,
    ...(nav.where ? { where: whereRenamed(nav.where, rename) } : {}),
    ...(nav.modal?.kind === "person" ? { modal: { ...nav.modal, name: rename(nav.modal.name) } } : {}),
  }
}

export function renamedAgents(app: App): number {
  const names: readonly string[] = DEMO_AGENT_HANDLES
  return (app.channel?.people ?? []).filter((p) => p.kind === "agent" && names.includes(p.name)).length
}
