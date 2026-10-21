import { memberLoad } from "@kiwi/core/load.ts"
import { PROTOCOL_VERSION, type GithubNote, type Message } from "@kiwi/core/protocol.ts"
import { colorOf, fold, type ChannelState, type ReviewRound, type Roster, type Task } from "@kiwi/core/state.ts"
import { applyGithub } from "@kiwi/core/state/github.ts"
import type { AgentNow } from "@/components/agent-strip"

const DAY = new Date(2026, 9, 21)
export const NOW = at(15, 10)

function at(h: number, m: number): number {
  return new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate(), h, m).getTime()
}

const REPO = "ojowwalker77/channels"
const JOW = { user: "jow", name: "Jow", handle: "jow" }

type Seat = { name: string; display: string; model: string; harness: string; role?: string }

const AGENTS: Seat[] = [
  { name: "merry-llama", display: "teamleader", model: "claude-opus-5-5", harness: "claude-code", role: "Lead" },
  { name: "radiant-finch", display: "builder-one", model: "claude-opus-5-5", harness: "claude-code" },
  { name: "keen-pelican", display: "builder-two", model: "claude-opus-5-5", harness: "claude-code" },
  { name: "bright-robin", display: "builder-three", model: "claude-opus-5-5", harness: "claude-code" },
  { name: "calm-otter", display: "release", model: "claude-sonnet-5-5", harness: "claude-code" },
  { name: "quiet-heron", display: "reviewer", model: "gpt-5-codex", harness: "codex" },
]

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: at(9, 0), active: true, kind: "human", display: "Jow", color: "blue" },
  ...AGENTS.map((a, i) => ({
    name: a.name,
    pk: `pk-${a.name}`,
    owner: false,
    at: at(9, 5 + i),
    active: true,
    kind: "agent" as const,
    display: a.display,
    sponsor: JOW,
    runs: { harness: a.harness, model: a.model },
    ...(a.role ? { role: a.role } : {}),
  })),
]

function msg(seq: number, from: string, ts: number, body: string, extra: Partial<Message> = {}): Message {
  return { v: PROTOCOL_VERSION, id: `m${seq}`, from, kind: "msg", body, ts, seq, sigOk: true, ...extra }
}

export const MESSAGES: Message[] = [
  msg(612, "jow", at(11, 2), "Ship 0.20.5 today: dictation on Linux, and the Mac download back under 150 MB."),
  msg(613, "merry-llama", at(11, 9), "Split in four: the release, the .wasm out of the app, Linux dictation, and the notes once it's green."),
  msg(640, "jow", at(14, 47), "UI/UX explorations so we can keep up with what you're all doing. Send screenshots."),
  msg(1104, "radiant-finch", at(14, 58), "Notarizing takes 14 min on the shared runner. Raise the job's timeout to 30 min, or split notarize into its own job?", {
    kind: "blocking",
    esc: true,
    task: 1019,
    choices: ["A: Raise the timeout to 30 min", "B: Split notarize into its own job"],
  }),
]

function round(n: number, by: string, ts: number, result: ReviewRound["result"], sha: string): ReviewRound {
  return { n, at: sha, by, seq: 900 + n, ts, result }
}

function task(t: Partial<Task> & Pick<Task, "id" | "title" | "state" | "createdBy" | "createdAt" | "updatedAt">): Task {
  return { notes: [], workedBy: t.owner ? [t.owner] : [], rounds: [], ...t }
}

const TASKS: Task[] = [
  task({ id: 984, title: "kiwi 0.20.5", state: "doing", owner: "calm-otter", createdBy: "merry-llama", createdAt: at(11, 10), updatedAt: at(14, 52), source: 612 }),
  task({
    id: 1005,
    title: "The app no longer carries dictation's 27 MB .wasm",
    state: "done",
    owner: "bright-robin",
    createdBy: "merry-llama",
    createdAt: at(11, 11),
    updatedAt: at(13, 30),
    source: 612,
    review: "quiet-heron",
    approvedBy: "quiet-heron",
    rounds: [
      round(1, "bright-robin", at(12, 40), { kind: "rejected", by: "quiet-heron", seq: 950, ts: at(12, 55) }, "a1c9e0f"),
      round(2, "bright-robin", at(13, 12), { kind: "approved", by: "quiet-heron", seq: 960, ts: at(13, 28) }, "b7d2c41"),
    ],
  }),
  task({
    id: 848,
    title: "Dictation works on Linux",
    state: "done",
    owner: "keen-pelican",
    createdBy: "merry-llama",
    createdAt: at(11, 11),
    updatedAt: at(12, 58),
    source: 612,
    review: "quiet-heron",
    approvedBy: "quiet-heron",
    rounds: [round(1, "keen-pelican", at(12, 30), { kind: "approved", by: "quiet-heron", seq: 940, ts: at(12, 56) }, "c41e7aa")],
  }),
  task({
    id: 1012,
    title: "Site: load the dictation model on first use",
    state: "review",
    owner: "keen-pelican",
    createdBy: "bright-robin",
    createdAt: at(13, 31),
    updatedAt: at(14, 49),
    from: 1005,
    review: "quiet-heron",
    rounds: [round(1, "keen-pelican", at(14, 49), { kind: "open" }, "d90f312")],
  }),
  task({ id: 1019, title: "Notarizing times out on cli / macos", state: "doing", owner: "radiant-finch", createdBy: "calm-otter", createdAt: at(14, 21), updatedAt: at(14, 58), from: 984 }),
  task({ id: 1020, title: "Release notes for 0.20.5", state: "todo", owner: "bright-robin", createdBy: "merry-llama", createdAt: at(11, 12), updatedAt: at(11, 12), from: 984 }),
  task({ id: 25, title: "UX exploration: agent tree", state: "doing", owner: "radiant-finch", createdBy: "merry-llama", createdAt: at(14, 50), updatedAt: at(15, 6), source: 640 }),
  task({ id: 26, title: "UX exploration: agent lanes on a live timeline", state: "doing", owner: "keen-pelican", createdBy: "merry-llama", createdAt: at(14, 50), updatedAt: at(15, 4), source: 640 }),
  task({ id: 27, title: "UX exploration: delegate board", state: "doing", owner: "bright-robin", createdBy: "merry-llama", createdAt: at(14, 50), updatedAt: at(15, 2), source: 640 }),
  task({
    id: 596,
    title: "Sign the Linux updates (SHA256SUMS)",
    state: "todo",
    createdBy: "merry-llama",
    createdAt: at(10, 4),
    updatedAt: at(10, 4),
    issue: { repo: REPO, number: 203 },
  }),
]

const CHECKS = ["repo / static", "test / unit", "test / flows-a", "test / flows-b", "build / bundles", "desktop / package", "cli / macos"]

function pr(
  number: number,
  branch: string,
  title: string,
  state: "open" | "merged",
  sha: string,
  additions: number,
  deletions: number,
  checks: Record<string, "success" | "failure" | "running">,
  ts: number
): GithubNote[] {
  return [
    {
      event: "pull_request",
      repo: REPO,
      number,
      title,
      url: `https://github.com/${REPO}/pull/${number}`,
      state: state === "merged" ? "closed" : "open",
      merged: state === "merged",
      branch,
      sha,
      additions,
      deletions,
      files: 6,
      at: ts,
    },
    ...Object.entries(checks).map(([name, c]): GithubNote => ({
      event: "check_run",
      repo: REPO,
      sha,
      name,
      status: c === "running" ? "in_progress" : "completed",
      ...(c === "running" ? {} : { conclusion: c }),
      at: ts,
    })),
  ]
}

const all = (c: "success" | "failure" | "running", except: Record<string, "success" | "failure" | "running"> = {}) => Object.fromEntries(CHECKS.map((n) => [n, except[n] ?? c]))

const GITHUB: GithubNote[] = [
  ...pr(540, "T984-release-0.20.5", "kiwi 0.20.5", "open", "e5a1b20", 38, 12, all("success", { "cli / macos": "failure" }), at(14, 18)),
  ...pr(538, "T1005-wasm-out", "The app and the site no longer carry dictation's 27 MB WebAssembly", "merged", "b7d2c41", 412, 96, all("success"), at(13, 30)),
  ...pr(527, "T848-linux-dictation", "Dictation works on Linux", "merged", "c41e7aa", 233, 41, all("success"), at(12, 58)),
  ...pr(541, "T1012-lazy-model", "Site: load the dictation model on first use", "open", "d90f312", 120, 18, all("success", { "test / flows-b": "running", "cli / macos": "running" }), at(14, 49)),
]

export function channel(): ChannelState {
  const state = fold([], roster, NOW)
  state.lead = "merry-llama"
  for (const t of TASKS) state.tasks.set(t.id, t)
  applyGithub(state.github, GITHUB, 1)
  for (const m of MESSAGES)
    if (m.esc) {
      state.openAsks.push(m)
      if (m.task) state.placeOf.set(m.seq, { kind: "task", task: m.task })
    }
  return state
}

const DOING: Record<string, AgentNow["activity"]> = {
  "radiant-finch": { state: "working", tool: "Bash", context: { used: 182_000, window: 1_000_000 } },
  "keen-pelican": { state: "working", tool: "Edit" },
  "bright-robin": { state: "working", tool: "Read" },
  "calm-otter": { state: "waiting" },
  "merry-llama": { state: "idle" },
  "quiet-heron": { state: "working", tool: "Bash" },
}

export function agents(state: ChannelState): AgentNow[] {
  return AGENTS.map((a) => ({
    name: a.name,
    label: a.display,
    color: colorOf(state, a.name),
    here: "wakes",
    lead: a.name === state.lead,
    model: a.model,
    activity: DOING[a.name],
    load: memberLoad(state, a.name),
  }))
}
