import { memberLoad } from "@kiwi/core/load.ts"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import { PROTOCOL_VERSION, type Activity, type Event, type GithubNote, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"
import type { AgentNow } from "@/components/agent-strip"
import type { How } from "@/lib/presence"

export const NOW = new Date(2026, 9, 21, 15, 8).getTime()
const MIN = 60_000
const REPO = "ojowwalker77/channels"

export interface Seeded {
  state: ChannelState
  messages: Message[]
  agents: AgentNow[]
  ids: Record<string, number>
}

interface Seat {
  name: string
  role: string
  model: string
  harness: string
  here: How | null
  activity?: Activity
  lastAt: number
}

const SEATS: Seat[] = [
  {
    name: "merry-llama",
    role: "lead",
    model: "claude-opus-5-5",
    harness: "claude-code",
    here: "wakes",
    activity: { state: "idle", since: NOW - 2 * MIN, context: { used: 412_000, window: 1_000_000 } },
    lastAt: NOW - 2 * MIN,
  },
  {
    name: "radiant-finch",
    role: "builder",
    model: "claude-opus-5-5",
    harness: "claude-code",
    here: "wakes",
    activity: { state: "working", tool: "Bash", since: NOW - 4 * MIN, context: { used: 182_000, window: 1_000_000 } },
    lastAt: NOW - 6 * MIN,
  },
  {
    name: "keen-pelican",
    role: "builder",
    model: "claude-opus-5-5",
    harness: "claude-code",
    here: "wakes",
    activity: { state: "idle", since: NOW - 6 * MIN, context: { used: 96_000, window: 1_000_000 } },
    lastAt: NOW - 6 * MIN,
  },
  {
    name: "bright-robin",
    role: "builder",
    model: "claude-opus-5-5",
    harness: "claude-code",
    here: "wakes",
    activity: { state: "idle", since: NOW - 3 * MIN, context: { used: 238_000, window: 1_000_000 } },
    lastAt: NOW - 3 * MIN,
  },
  {
    name: "amber-heron",
    role: "builder",
    model: "gpt-5-codex",
    harness: "codex",
    here: "wakes",
    activity: { state: "waiting", since: NOW - 9 * MIN, context: { used: 61_000, window: 400_000 } },
    lastAt: NOW - 9 * MIN,
  },
  {
    name: "quiet-otter",
    role: "reviewer",
    model: "claude-sonnet-5-5",
    harness: "claude-code",
    here: "wakes",
    activity: { state: "working", tool: "Read", since: NOW - 2 * MIN, context: { used: 74_000, window: 1_000_000 } },
    lastAt: NOW - 11 * MIN,
  },
  { name: "slate-wolf", role: "builder", model: "claude-sonnet-5-5", harness: "claude-code", here: null, lastAt: NOW - 128 * MIN },
]

export async function seed(): Promise<Seeded> {
  const roster: Roster = []
  const keys = new Map<string, Identity>()
  const log: Message[] = []
  let seq = 1440

  const join = async (name: string, kind: "human" | "agent", owner = false) => {
    const id = await generateIdentity(name)
    keys.set(name, id)
    roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind })
  }
  const at = (minutesAgo: number) => NOW - minutesAgo * MIN
  const post = async (from: string, minutesAgo: number, ev: Event | null, body = "", kind: Kind = ev ? "event" : "msg", extra: Partial<Payload> = {}): Promise<number> => {
    const ts = at(minutesAgo)
    seq++
    const payload: Payload = { v: PROTOCOL_VERSION, id: String(seq), from, kind, body, ts, ...(ev ? { ev } : {}), ...extra }
    const signed = await sign(keys.get(from)!, payload)
    log.push({ ...signed, seq, rts: ts, sigOk: await verify(signed) })
    return seq
  }
  const github = (minutesAgo: number, items: Omit<GithubNote, "repo" | "at">[]) =>
    post("jow", minutesAgo, { op: "github", items: items.map((i) => ({ ...i, repo: REPO, at: NOW - minutesAgo * MIN })) })
  const pr = (minutesAgo: number, number: number, branch: string, title: string, sha: string, by: string, additions: number, deletions: number) =>
    github(minutesAgo, [{ event: "pull_request", action: "opened", number, branch, title, sha, by, state: "open", additions, deletions, files: 6, url: `https://github.com/${REPO}/pull/${number}` }])
  const checks = (minutesAgo: number, sha: string, done: string[], running: string[], failed: string[] = []) =>
    github(minutesAgo, [
      ...done.map((name) => ({ event: "check_run" as const, sha, name, status: "completed", conclusion: "success" })),
      ...failed.map((name) => ({ event: "check_run" as const, sha, name, status: "completed", conclusion: "failure" })),
      ...running.map((name) => ({ event: "check_run" as const, sha, name, status: "in_progress" })),
    ])
  const CHECKS = ["repo / static", "test / unit", "test / flows-a", "test / flows-b", "build / bundles", "desktop / package", "ci-ok"]

  await join("jow", "human", true)
  for (const s of SEATS) await join(s.name, "agent")
  for (const s of SEATS) await post("jow", 360, { op: "role.set", member: s.name, role: s.role })
  for (const s of SEATS)
    await post(s.name, s.name === "slate-wolf" ? 300 : s.name === "bright-robin" ? 52 : 240, {
      op: "card",
      model: s.model,
      harness: s.harness,
      os: "macos",
      arch: "arm64",
      repo: REPO,
      fresh: NOW - (s.name === "bright-robin" ? 52 : 240) * MIN,
    })

  const lead = "merry-llama"
  const t848 = await post(lead, 330, { op: "task.add", title: "Dictation works on Linux", owner: "radiant-finch" })
  await post("radiant-finch", 320, { op: "task.update", task: t848, state: "doing", areas: ["web/src/lib/dictation", "desktop/src"] })
  await post("radiant-finch", 250, { op: "task.update", task: t848, state: "done", note: "PR #527 merged" })

  const t1456 = await post(lead, 70, { op: "task.add", title: "Permission row: allow for this session", owner: "radiant-finch" })
  await post("radiant-finch", 66, { op: "task.update", task: t1456, state: "doing", areas: ["web/src/components", "src/hooks"] })
  await pr(40, 539, `T${t1456}-permission-row`, "Permission row: allow for this session", "a1456", "radiant-finch", 214, 38)
  await checks(18, "a1456", CHECKS.slice(0, 6), ["ci-ok"])
  const t1690 = await post(lead, 30, { op: "task.add", title: "Permission rows remember “always” per tool", owner: "radiant-finch", from: t1456 })

  const t1615 = await post(lead, 120, { op: "task.add", title: "Edited messages say what they replaced", owner: "keen-pelican", review: "quiet-otter" })
  await post("keen-pelican", 115, { op: "task.update", task: t1615, state: "doing", areas: ["web/src/components", "packages/core/src/state"] })
  await pr(80, 541, `T${t1615}-edit-replaced`, "Edited messages say what they replaced", "b1615", "keen-pelican", 168, 22)
  await post("keen-pelican", 60, { op: "task.update", task: t1615, state: "review", at: "b1615a", note: "round 1" })
  await post("quiet-otter", 40, { op: "task.update", task: t1615, state: "doing", verdict: "rejected", round: 1, note: "the replaced text loses its line breaks" })
  await post("keen-pelican", 14, { op: "task.update", task: t1615, state: "review", at: "b1615" })
  await checks(6, "b1615", CHECKS.slice(0, 4), ["build / bundles", "desktop / package", "ci-ok"])

  const t1679 = await post(lead, 50, { op: "task.add", title: "Scroll stays pinned to the newest message", owner: "bright-robin" })
  await post("bright-robin", 48, { op: "task.update", task: t1679, state: "doing", areas: ["web/src/components/conversation"] })
  await post("bright-robin", 20, null, `T${t1679}: fix is in, running the shots before I push`, "status", { task: t1679 })

  const t1596 = await post(lead, 200, { op: "task.add", title: "Sign the Linux updates (SHA256SUMS)", owner: "amber-heron" })
  await post("amber-heron", 190, { op: "task.update", task: t1596, state: "doing", areas: ["scripts", "deploy"] })
  await post("amber-heron", 9, null, "Who signs the Linux updates: a secret in CI, or your own key? The release waits on this.", "blocking", {
    to: ["jow"],
    task: t1596,
    choices: ["A secret in CI", "My own key"],
  })

  const t1651 = await post(lead, 240, { op: "task.add", title: "Permission card polish", owner: "slate-wolf" })
  await post("slate-wolf", 236, { op: "task.update", task: t1651, state: "doing", areas: ["web/src/components"] })
  await post("slate-wolf", 130, { op: "task.update", task: t1651, note: "halfway: the deny state still needs its glyph; branch T1651-permission-polish", checkpoint: true })

  await post("radiant-finch", 18, { op: "lease.take", name: "heavy", ttl: 30 * 60, note: "web build + shoot-ui" })
  await post("bright-robin", 16, { op: "lease.take", name: "heavy", ttl: 20 * 60, note: `shoot-ui for T${t1679}` })

  const t1702 = await post(lead, 12, { op: "task.add", title: "Download the Linux dictation model on first use", from: t848 })
  const t1705 = await post("jow", 10, { op: "task.add", title: "Notarize the 0.24 DMG when a tag is pushed" })
  const t1708 = await post(lead, 8, { op: "task.add", title: "Keep the reply bar in view as the list grows", from: t1679 })
  const t1711 = await post(lead, 5, { op: "task.add", title: "Task rows say who is reviewing", detail: "In web/src/components/tasks-view.tsx, next to the PR cell." })
  await post(lead, 5, { op: "task.update", task: t1711, areas: ["web/src/components"] })

  const state = fold(log, roster, NOW)
  const agents: AgentNow[] = SEATS.map((s) => ({
    name: s.name,
    label: s.name,
    color: null,
    here: s.here,
    lead: s.name === lead,
    model: s.model,
    ...(s.activity ? { activity: s.activity } : {}),
    load: memberLoad(state, s.name),
    lastAt: s.lastAt,
    card: { repo: REPO },
  }))
  return { state, messages: log, agents, ids: { t848, t1456, t1690, t1615, t1679, t1596, t1651, t1702, t1705, t1708, t1711 } }
}
