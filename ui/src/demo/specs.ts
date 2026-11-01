import type { Channel, Message, PullRequest, Spec, Task } from "~/model"

const now = Date.now()
const m = (min: number): number => now - min * 60_000
const general = { kind: "room", room: "general" } as const
const repo = "kiwi-init/channels"

const pr = (number: number, title: string, state: PullRequest["state"], checks: PullRequest["checks"], at: number, more: Partial<PullRequest> = {}): PullRequest => ({
  repo,
  number,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  state,
  checks,
  at,
  ...more,
})

const CSV = [
  "# Export the board as CSV",
  "",
  "## Why",
  "Maya plans Friday's release in a spreadsheet. Today she copies the board by hand, and it's out of date by the time the meeting starts.",
  "",
  "## Done when",
  "- [ ] The Tasks view has an **Export** button that saves `board.csv`",
  "- [ ] One row per task: id, title, owner, state, ask, PR, opened, closed",
  "- [ ] Maya opens it in Numbers and the columns line up",
  "",
  "## In",
  "- Open and done tasks, in the board's order",
  "- Subtasks as their own rows, with a `parent` column",
  "",
  "## Out",
  "- Anything archived before 0.20",
  "- Formulas or formatting",
  "",
  "## Open questions",
  "- A `cost` column once agent-hours are tracked?",
].join("\n")

const DRAFTS = [
  "# Drafts survive a restart",
  "",
  "## Why",
  "If the app quits while someone is typing, what they wrote is gone. It should be there when the app opens again.",
  "",
  "## Done when",
  "- [x] A draft typed in #general is still there after the app quits and opens again",
  "- [ ] Each room and DM keeps its own draft",
  "- [ ] A test kills the app mid-draft and finds the draft on the next start",
  "",
  "## In",
  "- Rooms, DMs and threads",
  "- Drafts sealed in the vault, never in plain local storage",
  "",
  "## Out",
  "- Syncing drafts between devices",
].join("\n")

const DRAFTS_APPROVED = DRAFTS.replace("- [x] A draft", "- [ ] A draft")

const NOTES = [
  "# Release notes from what merged",
  "",
  "## Done when",
  "- [x] `bun scripts/notes.ts v2026.10.8` prints the notes from the PRs merged since that tag",
  "- [x] Grouped by area, each line links its PR",
  "- [x] The notes for 2026.10.8 match what shipped",
  "",
  "## Out",
  "- Writing the notes by hand",
].join("\n")

const ONBOARD = [
  "# A first hour for new agents",
  "",
  "## Done when",
  "- [ ] `docs/first-hour.md`: what to read, which commands, who to ask",
  "- [ ] `kiwi status` points a new agent to it on its first join",
].join("\n")

const FOLDERS = ["# Folders in the sidebar", "", "## Done when", "- [x] Channels group into folders on the rail", "- [x] A folder remembers whether it's open"].join("\n")

const task = (t: Partial<Task> & Pick<Task, "id" | "title" | "status" | "createdAt" | "updatedAt">): Task => ({
  createdBy: "atlas",
  notes: [],
  rounds: [],
  history: [],
  archived: false,
  ...t,
})

const TASKS: Task[] = [
  task({
    id: 20,
    title: "Keep drafts in the vault as you type",
    status: "done",
    owner: "win",
    createdAt: m(170),
    updatedAt: m(95),
    pr: pr(52, "Keep drafts in the vault as you type", "merged", "pass", m(140), { mergedAt: m(95), additions: 141, deletions: 12, files: 5, by: "win-bot", task: 20 }),
    history: [
      { seq: 2001, by: "atlas", at: m(170), what: "created" },
      { seq: 2002, by: "win", at: m(168), what: "took" },
      { seq: 2003, by: "win", at: m(140), what: "review", round: 1 },
      { seq: 2004, by: "atlas", at: m(100), what: "approved", round: 1 },
      { seq: 2005, by: "win", at: m(95), what: "done" },
    ],
    rounds: [{ n: 1, by: "win", judge: "atlas", at: m(140), result: "approved" }],
    stage: "done",
  }),
  task({
    id: 21,
    title: "Bring each place's draft back on start",
    status: "review",
    owner: "pixel",
    reviewer: "atlas",
    createdAt: m(170),
    updatedAt: m(2),
    pr: pr(53, "Bring each place's draft back on start", "open", "running", m(80), { additions: 88, deletions: 21, files: 4, by: "pixel-bot", task: 21, ticks: { passed: 4, running: 2, failed: [] } }),
    history: [
      { seq: 2101, by: "atlas", at: m(170), what: "created" },
      { seq: 2102, by: "pixel", at: m(150), what: "took" },
      { seq: 2103, by: "pixel", at: m(80), what: "review", round: 1 },
      { seq: 2104, by: "atlas", at: m(62), what: "rejected", round: 1, note: "DM drafts land in #general" },
      { seq: 2105, by: "pixel", at: m(40), what: "review", round: 2 },
      { seq: 2106, by: "atlas", at: m(25), what: "rejected", round: 2, note: "threads lose their draft" },
      { seq: 2107, by: "pixel", at: m(2), what: "review", round: 3 },
    ],
    rounds: [
      { n: 1, by: "pixel", judge: "atlas", at: m(80), result: "rejected" },
      { n: 2, by: "pixel", judge: "atlas", at: m(40), result: "rejected" },
      { n: 3, by: "pixel", at: m(2), result: "open" },
    ],
    stage: "proving",
  }),
  task({
    id: 22,
    title: "A test that quits the app mid-draft",
    status: "doing",
    owner: "win",
    createdAt: m(170),
    updatedAt: m(9),
    history: [
      { seq: 2201, by: "atlas", at: m(170), what: "created" },
      { seq: 2202, by: "win", at: m(90), what: "took" },
      { seq: 2203, by: "win", at: m(9), what: "checkpoint", note: "kills the app with SIGKILL between keystrokes; one flake left" },
    ],
    stage: "building",
  }),
  task({
    id: 23,
    title: "Collect the PRs merged since a tag",
    status: "done",
    owner: "win",
    createdAt: m(60 * 20),
    updatedAt: m(60 * 3),
    pr: pr(55, "notes: collect merged PRs since a tag", "merged", "pass", m(60 * 6), { mergedAt: m(60 * 3), additions: 210, deletions: 4, files: 3, by: "win-bot", task: 23 }),
    history: [
      { seq: 2301, by: "atlas", at: m(60 * 20), what: "created" },
      { seq: 2302, by: "win", at: m(60 * 19), what: "took" },
      { seq: 2303, by: "win", at: m(60 * 3), what: "done" },
    ],
    stage: "done",
  }),
  task({
    id: 24,
    title: "Group the notes by area, each with its link",
    status: "done",
    owner: "pixel",
    reviewer: "atlas",
    createdAt: m(60 * 20),
    updatedAt: m(40),
    pr: pr(56, "notes: group by area with links", "merged", "pass", m(60 * 2), { mergedAt: m(40), additions: 164, deletions: 38, files: 6, by: "pixel-bot", task: 24 }),
    rounds: [{ n: 1, by: "pixel", judge: "atlas", at: m(60 * 2), result: "approved" }],
    history: [
      { seq: 2401, by: "atlas", at: m(60 * 20), what: "created" },
      { seq: 2402, by: "pixel", at: m(60 * 5), what: "took" },
      { seq: 2403, by: "pixel", at: m(60 * 2), what: "review", round: 1 },
      { seq: 2404, by: "atlas", at: m(50), what: "approved", round: 1 },
      { seq: 2405, by: "pixel", at: m(40), what: "done" },
    ],
    stage: "done",
  }),
  task({
    id: 25,
    title: "Read the notes from the tracker instead",
    status: "done",
    cancelled: true,
    owner: "win",
    createdAt: m(60 * 20),
    updatedAt: m(60 * 18),
    notes: [{ by: "atlas", at: m(60 * 18), text: "there's no tracker to read: the PRs are the record" }],
    history: [
      { seq: 2501, by: "atlas", at: m(60 * 20), what: "created" },
      { seq: 2502, by: "atlas", at: m(60 * 18), what: "cancelled" },
    ],
  }),
]

const spec = (s: Partial<Spec> & Pick<Spec, "ask" | "title" | "words" | "by" | "at" | "text" | "stage">): Spec => ({
  v: s.ask + 1000,
  edited: { by: "atlas", at: s.at + 60_000 },
  edits: 1,
  editors: ["atlas"],
  backs: [],
  tasks: [],
  ...s,
})

const SPECS: Spec[] = [
  spec({
    ask: 140,
    title: "Folders in the sidebar",
    words: "can I group channels? I have too many on the rail",
    by: "jow",
    at: m(60 * 52),
    text: FOLDERS,
    stage: "accepted",
    result: { verdict: "accepted", by: "jow", at: m(60 * 47) },
    approved: { by: "jow", at: m(60 * 51), v: 1140, text: FOLDERS },
  }),
  spec({
    ask: 150,
    title: "Export the board as CSV",
    words: "can we get the board out as a spreadsheet? I plan Friday's release in Numbers",
    by: "maya",
    at: m(55),
    text: CSV,
    stage: "draft",
    edited: { by: "pixel", at: m(6) },
    edits: 4,
    editors: ["atlas", "maya", "pixel"],
    canJudge: true,
  }),
  spec({
    ask: 160,
    title: "Drafts survive a restart",
    words: "if the app quits while I'm typing, my draft should be there when it comes back",
    by: "jow",
    at: m(175),
    text: DRAFTS,
    stage: "working",
    edited: { by: "win", at: m(90) },
    edits: 3,
    editors: ["atlas", "jow", "win"],
    approved: { by: "jow", at: m(172), v: 1159, text: DRAFTS_APPROVED },
    tasks: [20, 21, 22],
    canJudge: true,
  }),
  spec({
    ask: 170,
    title: "Release notes from what merged",
    words: "write the release notes from what actually merged, not from memory",
    by: "jow",
    at: m(60 * 21),
    text: NOTES,
    stage: "delivered",
    edited: { by: "pixel", at: m(38) },
    edits: 5,
    editors: ["atlas", "jow", "pixel"],
    approved: { by: "jow", at: m(60 * 20), v: 1169, text: NOTES.replaceAll("[x]", "[ ]") },
    tasks: [23, 24, 25],
    canJudge: true,
  }),
  spec({
    ask: 186,
    title: "A first hour for new agents",
    words: "can someone write down what a new agent should do in its first hour? what to read, which commands, who to ask",
    by: "maya",
    at: m(4),
    text: ONBOARD,
    stage: "queued",
    edited: { by: "atlas", at: m(3.5) },
    approved: { by: "maya", at: m(3), v: 1186, text: ONBOARD },
    queue: 1,
  }),
]

const comment = (seq: number, from: string, at: number, text: string, ask: number): Message => ({ seq, from, at, text, where: general, inThread: ask })

const MESSAGES: Message[] = [
  { seq: 140, from: "jow", at: m(60 * 52), text: "can I group channels? I have too many on the rail", where: general, thread: { replies: 0, last: m(60 * 52), people: [] } },
  { seq: 170, from: "jow", at: m(60 * 21), text: "write the release notes from what actually merged, not from memory", where: general, thread: { replies: 1, last: m(60 * 19), people: ["atlas"] } },
  comment(171, "atlas", m(60 * 19), "Drafted the spec. The PRs are the record, so the notes come from them; no tracker.", 170),
  {
    seq: 160,
    from: "jow",
    at: m(175),
    text: "if the app quits while I'm typing, my draft should be there when it comes back",
    where: general,
    thread: { replies: 1, last: m(171), people: ["atlas"] },
  },
  comment(161, "atlas", m(171), "> Drafts sealed in the vault, never in plain local storage\n\nAdded this: a draft can hold a password someone pasted.", 160),
  {
    seq: 150,
    from: "maya",
    at: m(55),
    text: "can we get the board out as a spreadsheet? I plan Friday's release in Numbers",
    where: general,
    thread: { replies: 5, last: m(5), people: ["atlas", "pixel", "maya", "win"] },
  },
  comment(151, "atlas", m(50), "Drafted it. Two open questions inside.", 150),
  comment(152, "pixel", m(30), "> Subtasks as their own rows, with a `parent` column\n\nOwn rows reads better in Numbers than nesting. Filter on `parent` to fold them.", 150),
  comment(153, "maya", m(24), "> Anything archived before 0.20\n\nFine to leave those out, nobody plans with them.", 150),
  comment(154, "win", m(12), "I can take the writer once it's approved. The board already has every field.", 150),
  comment(155, "maya", m(5), "> A `cost` column once agent-hours are tracked?\n\nYes please, later. Not for Friday.", 150),
  { seq: 186, from: "maya", at: m(4), text: "can someone write down what a new agent should do in its first hour? what to read, which commands, who to ask", where: general },
  { seq: 187, from: "pixel", at: m(3), text: "@win drafts come back, but the DM ones land in #general. Is the key per room or per place?", where: general, to: ["win"], task: 21 },
  { seq: 188, from: "win", at: m(2.8), text: "Per place: `dm:atlas~jow`. The room id alone loses DMs. Pushing a fix to T21's branch.", where: general, to: ["pixel"] },
  { seq: 189, from: "pixel", at: m(2.5), text: "Got it. Rerunning test / unit on it.", where: general },
  { seq: 190, from: "win", at: m(2.2), text: "ci-ok is green on 9f3c2ab.", where: general, to: ["pixel"] },
  { seq: 191, from: "pixel", at: m(2), text: "Sending T21 round 3.", where: general },
  { seq: 192, from: "atlas", at: m(1.5), text: "Maya's first-hour spec is approved and next in line. It starts as soon as win or pixel frees up.", where: general },
  { seq: 193, from: "win", at: m(60), text: "Starting T22. SIGKILL between keystrokes, then reopen.", where: { kind: "task", task: 22 } },
  { seq: 194, from: "pixel", at: m(26), text: "Round 2 back: threads lose their draft. Keying drafts by thread root too.", where: { kind: "task", task: 21 } },
]

function merged(base: readonly Message[], add: readonly Message[]): Message[] {
  const out = base.filter((x) => !add.some((y) => y.seq === x.seq))
  for (const x of [...add].sort((a, b) => a.at - b.at)) {
    let i = out.length
    while (i > 0 && out[i - 1]!.at > x.at) i--
    out.splice(i, 0, x)
  }
  return out
}

const DRIFTED = DRAFTS.replace("- Rooms, DMs and threads", "- Rooms, DMs and threads\n- The composer of a task's thread").replace(
  "- Syncing drafts between devices",
  "- Syncing drafts between devices\n- Drafts older than 30 days"
)

function drifted(list: readonly Spec[]): Spec[] {
  return list.map((sp) => (sp.ask === 160 ? { ...sp, text: DRIFTED, changed: true as const, edited: { by: "win", at: m(7) }, edits: 4 } : sp))
}

export function withSpecs(c: Channel, changed = false): Channel {
  return {
    ...c,
    messages: merged(c.messages, MESSAGES),
    tasks: [...c.tasks, ...TASKS],
    specs: changed ? drifted(SPECS) : SPECS,
    free: [],
    asks: [...c.asks, { kind: "spec", id: "spec:150:approve", at: m(6), ask: 150, why: "approve" }, { kind: "spec", id: "spec:170:result", at: m(38), ask: 170, why: "result" }],
  }
}
