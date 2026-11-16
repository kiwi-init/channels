import type { Channel, CheckpointAgent, CheckpointRound } from "~/model"

export function withCheckpoints(channel: Channel): Channel {
  const owing = channel.people
    .filter((p) => p.kind === "agent")
    .map((p) => ({ name: p.name, tasks: channel.tasks.filter((x) => x.owner === p.name && x.status !== "done" && !x.archived).map((x) => x.id), lead: channel.lead === p.name }))
    .filter((a) => a.tasks.length > 0 || a.lead)
  const agents = owing.map((a, i): CheckpointAgent =>
    i === 1 ? { name: a.name, state: "pending", tasks: a.tasks.slice(-1), lead: false } : i === 2 ? { name: a.name, state: "unreachable" } : { name: a.name, state: "saved" }
  )
  return { ...channel, checkpointDaily: { at: "18:00", tz: "America/Sao_Paulo" }, checkpoints: { seq: 9_000, at: Date.now() - 4 * 60_000, daily: true, agents } }
}

export function demoRound(channel: Channel, running: readonly string[], seq: number, at: number): CheckpointRound {
  const agents = channel.people
    .filter((p) => p.kind === "agent")
    .map((p) => ({ name: p.name, tasks: channel.tasks.filter((x) => x.owner === p.name && x.status !== "done" && !x.archived).map((x) => x.id), lead: channel.lead === p.name }))
    .filter((a) => a.tasks.length > 0 || a.lead)
    .map((a): CheckpointAgent => (running.includes(a.name) ? { name: a.name, state: "pending", tasks: a.tasks, lead: a.lead } : { name: a.name, state: "unreachable" }))
  return { seq, at, daily: false, agents }
}
