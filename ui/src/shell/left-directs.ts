import { memberOf, type Channel, type Direct } from "~/model"

export function leftDirects(channel: Pick<Channel, "people" | "former" | "directs">, listed: ReadonlySet<string>): { people: Direct[]; agents: Direct[] } {
  const left = channel.directs.filter((d) => !listed.has(d.with))
  const agent = (d: Direct) => memberOf(channel, d.with)?.kind === "agent"
  return { people: left.filter((d) => !agent(d)), agents: left.filter(agent) }
}
