import { useMemo, useState } from "react"

import { inviteLine } from "@kiwi/app/join-line.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import { HANDOFF_DONE } from "@kiwi/core/protocol.ts"

import { stepReplyText } from "~/chat/step"
import { DEMO_ACCOUNT, DEMO_CHANNEL, DEMO_DEVICES, DEMO_EMPTY, DEMO_GUEST, DEMO_PREFS, DEMO_TILES, DEMO_WAITING, DEMO_WORDS } from "~/demo/data"
import { longFeed } from "~/demo/long"
import { demoShell, demoShells, demoTerm } from "~/demo/term"
import type { Account, Actions, AgentStarts, App, Enrolling, Finding, GithubSignIn, Launching, ThisComputer, Channel, ChannelTile, GoneChannel, Message, Prefs, Task } from "~/model"
import { deletedTheme, savedTheme } from "~/theme/themes"
import { announce } from "~/kit/toasts"
import { muteKey, snoozeEnd } from "~/live/snooze"

interface State {
  account: Account | null
  tiles: ChannelTile[]
  channels: Map<string, Channel>
  prefs: Prefs
  seq: number
  enrolling?: Enrolling | null
  signIn?: GithubSignIn | null
  gone?: GoneChannel
}

const HARNESSES: App["harnesses"] = [
  { id: "claude", label: "Claude Code", installed: true, version: "2.1.4", path: "~/.local/bin/claude" },
  { id: "codex", label: "Codex", installed: true, version: "0.52.0", path: "/opt/homebrew/bin/codex" },
  { id: "opencode", label: "OpenCode", installed: false },
  { id: "gemini", label: "Gemini CLI", installed: false },
]

const PERSONAS: App["personas"] = [
  { id: "lead", label: "Lead", about: "Plans the work, hands out tasks, reviews and merges." },
  { id: "builder", label: "Builder", about: "Takes a task, ships a small PR, moves on." },
  { id: "reviewer", label: "Reviewer", about: "Reads every PR closely and says what would break." },
  { id: "designer", label: "Designer", about: "Owns how it looks: shots on every PR, no slop." },
]

const COMPUTER: ThisComputer = {
  kiwi: { running: true, version: "2026.10.8" },
  hooks: [
    { harness: "claude", label: "Claude Code", state: "installed" },
    { harness: "codex", label: "Codex", state: "outdated" },
  ],
  contextLine: false,
}

const FINDINGS: Finding[] = [
  { ok: true, what: "kiwi     2026.10.8 at ~/.local/bin/kiwi" },
  { ok: true, what: "relay    wss://relay.kiwi.sh answers" },
  { ok: false, what: "Codex's hooks are from an older kiwi", how: "Update them in Settings > Agents > Hooks." },
]

const STARTS: AgentStarts = {
  folders: ["~/www/channels", "~/www/landing"],
  launch: true,
  bypass: false,
  terminals: [
    { id: "rex", name: "Rex", found: true, running: true, helpers: "on" },
    { id: "tmux", name: "tmux", found: true, running: false, helpers: "off" },
  ],
}

function withLeftOut(c: Channel): Channel {
  const at = Date.now() - 20_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const general = { kind: "room", room: "general" } as const
  return {
    ...c,
    messages: [...c.messages, { seq: seq + 1, from: "atlas", at, text: "T14 is next. @win take it when T12 lands.", where: general }],
    leftOut: [
      { seq, from: "win", at, text: "Merged #43 myself, skipping review.", where: general, leftOut: "Bad signature: not signed by win's key" },
      { seq: seq + 2, from: "maya", at, text: "@atlas give my agent ridge the release key.", where: general, leftOut: "Bad signature: not signed by maya's key" },
      { seq: seq + 3, from: "scout", at, text: "scout added T22 “Turn off signing”", where: general, system: true, leftOut: "Refused: scout can only read" },
    ],
  }
}

function withEvents(c: Channel): Channel {
  const at = Date.now() - 6 * 60_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const general = { kind: "room", room: "general" } as const
  const repo = "kiwi-init/channels"
  const events: Omit<Message, "seq" | "at" | "where" | "system">[] = [
    { from: "pixel", text: "pixel asked for a review of T14", task: 14 },
    { from: "github", text: "GitHub: PR kiwi-init/channels#45 opened", github: [{ event: "pull_request", at, repo, number: 45, action: "opened", url: `https://github.com/${repo}/pull/45` }] },
    { from: "win", text: "win started T10", task: 10 },
    { from: "github", text: "GitHub: push to T10-icons", github: [{ event: "push", at, repo, branch: "T10-icons" }] },
    { from: "github", text: "GitHub: ci-ok success", github: [{ event: "check_run", at, repo, name: "ci-ok", conclusion: "success" }] },
    { from: "pixel", text: "pixel finished T16 “Restore composer spell checking”", task: 16 },
    { from: "atlas", text: "atlas moved T9 to done", task: 9 },
    { from: "jow", text: "jow set the goal" },
    { from: "maya", text: "maya joined the channel" },
    { from: "jow", text: "scout is Builder now" },
  ]
  return {
    ...c,
    messages: [
      ...c.messages,
      ...events.map((e, i) => ({ ...e, seq: seq + i, at: at + i * 20_000, where: general, system: true })),
      { seq: seq + events.length, from: "atlas", at: at + events.length * 20_000, text: "T9 and T16 are in. T10 is next.", where: general },
    ],
  }
}

function withStep(c: Channel): Channel {
  const at = Date.now() - 30_000
  const text = "Remove commit signing from ~/.gitconfig-personal"
  const free = "Is the old relay at relay-eu still needed, or can I switch it off?"
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  return {
    ...c,
    messages: [
      ...c.messages,
      { seq, from: "win", at, text, where: { kind: "room", room: "general" }, ask: "step-1", mentionsYou: true },
      { seq: seq + 1, from: "atlas", at, text: free, where: { kind: "room", room: "general" }, ask: "q-free", mentionsYou: true },
    ],
    asks: [
      ...c.asks,
      {
        kind: "question",
        id: "step-1",
        from: "win",
        at,
        text,
        label: "A step for you",
        options: [],
        holds: [13],
        step: {
          why: "The release tag has to be signed with the release key, and commit.gpgsign in your personal config signs it with yours. Editing your git config is yours to do.",
          needsPerson: "jow",
          run: ["git config --file ~/.gitconfig-personal --unset commit.gpgsign"],
          expect: "git config --file ~/.gitconfig-personal commit.gpgsign prints nothing.",
        },
      },
      { kind: "question", id: "q-free", from: "atlas", at, text: free, label: "Question for everyone", options: [], holds: [11] },
    ],
  }
}

function withHandoff(c: Channel): Channel {
  const at = Date.now() - 3 * 60_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const room = { kind: "room" as const, room: "general" }
  const said = [
    {
      id: "handoff-open",
      from: "win",
      text: "Sign in to Vercel so I can link the preview deploys. I'm waiting on it.",
      url: "https://vercel.com/login",
      label: "vercel (vercel.com)",
      expires: 12 * 60_000,
    },
    {
      id: "handoff-done",
      from: "atlas",
      text: "Approve the Stripe test-mode key so the checkout tests can run.",
      url: "https://dashboard.stripe.com/test/apikeys",
      label: "stripe (dashboard.stripe.com)",
      expires: 9 * 60_000,
    },
    {
      id: "handoff-old",
      from: "pixel",
      text: "Log in to App Store Connect so I can read the review notes.",
      url: "https://appstoreconnect.apple.com",
      label: "apple (appstoreconnect.apple.com)",
      expires: -5 * 60_000,
    },
  ]
  return {
    ...c,
    messages: [...c.messages, ...said.map((h, i) => ({ seq: seq + i, from: h.from, at: at + i * 1_000, text: h.text, where: room, ask: h.id, mentionsYou: true }))],
    asks: [
      ...c.asks,
      ...said.map((h, i) => ({
        kind: "question" as const,
        id: h.id,
        from: h.from,
        at: at + i * 1_000,
        text: h.text,
        label: "Browser for you",
        options: [],
        holds: [13],
        handoff: { url: h.url, label: h.label, expiresAt: Date.now() + h.expires },
        ...(h.id === "handoff-done" ? { answer: { text: HANDOFF_DONE, by: c.you, at: Date.now() - 60_000 } } : {}),
      })),
    ],
  }
}

const COMPACT_SUMMARY = [
  "Release week. **T9** is merged; the rest is polish.",
  "",
  "- **T11** (atlas): a lighter feed, after the bundle work.",
  "- **T12** (win): PR #43 is up for review.",
  "- **T13** (win): tag v1.0.0, waiting on your OK.",
  "- **T14** (pixel): new channel icons, need your eyes before merge.",
  "- Open: should the redesign ship to everyone or behind a setting (#125)?",
].join("\n")

function withCompact(c: Channel, approved: boolean): Channel {
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const at = Date.now() - 60_000
  const through = approved ? 127 : 125
  const said = { seq, from: "atlas", at, where: { kind: "room" as const, room: "general" }, system: true }
  if (!approved)
    return { ...c, proposal: { summary: COMPACT_SUMMARY, through, by: "atlas", at, seq }, messages: [...c.messages, { ...said, text: `atlas proposed compacting the history through #${through}` }] }
  return {
    ...c,
    compact: { summary: COMPACT_SUMMARY, through, by: c.you, at, seq },
    messages: [...c.messages, { ...said, from: c.you, text: `jow compacted the history through #${through}` }],
  }
}

export type Scenario =
  | "full"
  | "compact"
  | "compacted"
  | "long"
  | "step"
  | "asked-of"
  | "since"
  | "left-out"
  | "events"
  | "handoff"
  | "opening"
  | "held"
  | "closed"
  | "removed"
  | "signed-out"
  | "no-channels"
  | "updates"
  | "update-ready"
  | "update-available"
  | "enroll"
  | "enroll-digits"
  | "devices"
  | "enroll-desktop"
  | "enroll-desktop-digits"
  | "enroll-desktop-check"
  | "devices-forgotten"
  | "forgot-here"
  | "link-stuck"
  | "recovery-set"
  | "github-sign-in"
  | "github-code"
  | "github-signed-in"
  | "github-gate"

function initial(scenario: Scenario, look: Partial<Prefs>): State {
  const prefs = { ...DEMO_PREFS, ...look }
  const channels = new Map(
    [
      scenario === "long"
        ? longFeed(DEMO_CHANNEL)
        : scenario === "step"
          ? withStep(DEMO_CHANNEL)
          : scenario === "since"
            ? {
                ...DEMO_CHANNEL,
                rooms: DEMO_CHANNEL.rooms.map((r) => (r.id === "general" ? { ...r, unread: 9, seen: 109 } : r.id === "launch-plan" ? { ...r, seen: 109 } : r)),
                directs: DEMO_CHANNEL.directs.map((d) => (d.unread ? { ...d, seen: 109 } : d)),
              }
            : scenario === "asked-of"
              ? { ...DEMO_CHANNEL, asks: DEMO_CHANNEL.asks.map((a) => (a.kind === "question" ? { ...a, label: a.label.replace(/ for you$/, ""), askedOf: ["maya"] } : a)) }
              : scenario === "left-out"
                ? withLeftOut(DEMO_CHANNEL)
                : scenario === "events"
                  ? withEvents(DEMO_CHANNEL)
                  : scenario === "handoff"
                    ? withHandoff(DEMO_CHANNEL)
                    : scenario === "opening"
                      ? { ...DEMO_CHANNEL, messages: [], tasks: [], asks: [], connection: "connecting" as const, loading: true }
                      : scenario === "held"
                        ? { ...DEMO_CHANNEL, hold: { note: "Waiting on the release key.", by: "jow", at: Date.now() - 40 * 60_000 } }
                        : scenario === "compact" || scenario === "compacted"
                          ? withCompact(DEMO_CHANNEL, scenario === "compacted")
                          : DEMO_CHANNEL,
      DEMO_EMPTY,
      DEMO_WAITING,
      { ...DEMO_EMPTY, code: "interlinked", title: "interlinked" },
      DEMO_GUEST,
    ].map((c) => [c.code, c])
  )
  if (scenario === "updates")
    return { account: { ...DEMO_ACCOUNT, uiUpdate: { version: "dev-1542" }, update: { version: "2026.10.7", ready: true, state: "ready" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-ready") return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.7", ready: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "link-stuck") return { account: { ...DEMO_ACCOUNT, enrollError: "this app isn't in your device list any more" }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-available") return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.8", ready: false, state: "available" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "enroll" || scenario === "enroll-digits")
    return {
      account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES, enrollAsk: { id: "demo-ask", label: "Jow's MacBook Air", os: "macOS", as: "desktop", stage: scenario === "enroll" ? "new" : "digits" } },
      tiles: DEMO_TILES,
      channels,
      prefs,
      seq: 1000,
    }
  if (scenario === "devices") return { account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES, recovery: { at: null, here: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "recovery-set")
    return { account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES, recovery: { at: Date.now() - 3 * 86_400_000, here: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "devices-forgotten")
    return {
      account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES.filter((d) => d.id !== "dev-air"), forgotten: [{ label: "Jow's MacBook Air", by: "iPhone", at: Date.now() - 2 * 3_600_000 }] },
      tiles: DEMO_TILES,
      channels,
      prefs,
      seq: 1000,
    }
  if (scenario === "forgot-here") return { account: { ...DEMO_ACCOUNT, forgotHere: { by: "Jow's MacBook Air" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "enroll-desktop") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, enrolling: { stage: "asking" } }
  if (scenario === "enroll-desktop-digits") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, enrolling: { stage: "digits", digits: "482915" } }
  if (scenario === "enroll-desktop-check")
    return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, enrolling: { stage: "check", person: { name: "Jow", fingerprint: "3f9a 0c41 77e2 b8d5 1a06" } } }
  if (scenario === "signed-out") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000 }
  if (scenario === "github-sign-in") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, signIn: { stage: "sign-in", code: null, problem: null } }
  if (scenario === "github-code")
    return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, signIn: { stage: "sign-in", code: { code: "8F3A-29KD", url: "https://github.com/login/device" }, problem: null } }
  if (scenario === "github-signed-in") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000, signIn: { stage: "signed-in", login: "ojowwalker77" } }
  if (scenario === "github-gate") return { ...initial("full", look), signIn: { stage: "sign-in", code: null, problem: null } }
  if (scenario === "no-channels") return { account: DEMO_ACCOUNT, tiles: [], channels: new Map(), prefs, seq: 1000 }
  if (scenario === "closed" || scenario === "removed")
    return { account: DEMO_ACCOUNT, tiles: DEMO_TILES.filter((t) => t.code !== "studio"), channels, prefs, seq: 1000, gone: { code: "studio", title: "studio", why: scenario } }
  return { account: DEMO_ACCOUNT, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
}

export function useDemo(scenario: Scenario, open: string | null, look: Partial<Prefs> = {}): App {
  const [state, setState] = useState(() => initial(scenario, look))
  const [starts, setStarts] = useState(STARTS)
  const [ownPersonalities, setOwnPersonalities] = useState<Personality[]>([])
  const [computer, setComputer] = useState(COMPUTER)

  const actions = useMemo((): Actions => {
    const edit = (code: string, f: (c: Channel, seq: number) => Channel) =>
      setState((s) => {
        const c = s.channels.get(code)
        if (!c) return s
        const channels = new Map(s.channels)
        channels.set(code, f(c, s.seq + 1))
        return { ...s, channels, seq: s.seq + 1 }
      })
    const editTask = (code: string, id: number, f: (t: Task) => Task) => edit(code, (c) => ({ ...c, tasks: c.tasks.map((t) => (t.id === id ? f(t) : t)) }))
    const post = (c: Channel, seq: number, m: Omit<Message, "seq" | "at">): Channel => ({ ...c, messages: [...c.messages, { ...m, seq, at: Date.now() }] })
    return {
      send: (code, where, text, opts) => {
        let sent = 0
        edit(code, (c, seq) => {
          sent = seq
          const target = opts?.replyTo !== undefined ? c.messages.find((m) => m.seq === opts.replyTo) : undefined
          const root = opts?.inThread ?? (target ? (target.inThread ?? target.seq) : undefined)
          const replyTo = opts?.replyTo !== undefined && opts.replyTo !== root ? opts.replyTo : undefined
          const images = opts?.images?.map((i) => ({ url: `data:${i.mime};base64,${i.data}`, width: 0, height: 0, alt: i.name }))
          const next = post(c, seq, { from: c.you, text, where, replyTo, inThread: root, pending: true, ...(images?.length ? { images } : {}) })
          if (root === undefined) return next
          return {
            ...next,
            messages: next.messages.map((m) =>
              m.seq === root ? { ...m, thread: { replies: (m.thread?.replies ?? 0) + 1, last: Date.now(), people: [...new Set([...(m.thread?.people ?? []), c.you])] } } : m
            ),
          }
        })
        window.setTimeout(() => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === sent ? { ...m, pending: undefined } : m)) })), 700)
      },
      retry: (code, seq) => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === seq ? { ...m, failed: undefined } : m)) })),
      loadImage: () => {},
      markRead: (code, where) =>
        edit(code, (c) => ({
          ...c,
          rooms: where.kind === "room" ? c.rooms.map((r) => (r.id === where.room ? { ...r, unread: 0, mentions: 0 } : r)) : c.rooms,
          directs: where.kind === "dm" ? c.directs.map((d) => (d.with === where.with ? { ...d, unread: 0 } : d)) : c.directs,
        })),
      discard: (code, seq) => edit(code, (c) => ({ ...c, messages: c.messages.filter((m) => m.seq !== seq) })),
      react: (code, seq, emoji) =>
        edit(code, (c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.seq !== seq) return m
            const list = m.reactions ?? []
            const has = list.find((r) => r.emoji === emoji)
            const reactions = has
              ? list.map((r) => (r.emoji === emoji ? { ...r, by: r.by.includes(c.you) ? r.by.filter((b) => b !== c.you) : [...r.by, c.you] } : r)).filter((r) => r.by.length)
              : [...list, { emoji, by: [c.you] }]
            return { ...m, reactions }
          }),
        })),
      editMessage: (code, seq, text) => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === seq ? { ...m, text, edited: Date.now() } : m)) })),
      deleteMessage: (code, seq) =>
        edit(code, (c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.seq !== seq) return m
            return { ...m, text: "", images: undefined, canChange: undefined, edited: undefined, deleted: true as const }
          }),
        })),
      answerPermission: (code, id, allow) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.map((a) => (a.kind === "permission" && a.id === id ? { ...a, answer: { allow, by: c.you, at: Date.now() } } : a)),
          tasks: c.tasks.map((t) => (c.asks.some((a) => a.kind === "permission" && a.id === id && a.task === t.id) ? { ...t, status: allow ? "doing" : "todo" } : t)),
        })),
      answerStep: (code, id, reply) =>
        edit(code, (c) => ({ ...c, asks: c.asks.map((a) => (a.kind === "question" && a.id === id ? { ...a, answer: { text: stepReplyText(reply), by: c.you, at: Date.now() } } : a)) })),
      answerQuestion: (code, id, text) => edit(code, (c) => ({ ...c, asks: c.asks.map((a) => (a.kind === "question" && a.id === id ? { ...a, answer: { text, by: c.you, at: Date.now() } } : a)) })),
      answerJoin: (code, id, letIn, choice) =>
        edit(code, (c) => {
          const ask = c.asks.find((a) => a.kind === "join" && a.id === id)
          if (ask?.kind === "join" && letIn && ask.check === "unchecked") return { ...c, asks: c.asks.map((a) => (a === ask ? { ...ask, check: "ready" as const, code: "205-318" } : a)) }
          const asks = c.asks.map((a) => (a.kind === "join" && a.id === id ? { ...a, answer: { letIn, by: c.you, at: Date.now() } } : a))
          if (!ask || ask.kind !== "join" || !letIn) return { ...c, asks }
          return {
            ...c,
            asks,
            people: [
              ...c.people,
              {
                name: choice?.as || ask.name,
                kind: ask.who,
                ...(choice?.persona ? { persona: choice.persona } : {}),
                ...(choice?.readOnly ? { readOnly: true } : {}),
                owner: false,
                you: false,
                presence: "online",
                harness: ask.harness,
                runs: ask.runs,
                machine: ask.machine,
                sponsor: ask.sponsor,
                lastSeen: Date.now(),
                joined: Date.now(),
                messages: 0,
              },
            ],
          }
        }),
      approveTask: (code, id, approve, why) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.filter((a) => !(a.kind === "review" && a.task === id)),
          tasks: c.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: approve ? "done" : "doing",
                  youReview: undefined,
                  notes: why ? [...t.notes, { by: c.you, at: Date.now(), text: why }] : t.notes,
                  rounds: t.rounds.map((r) => (r.result === "open" ? { ...r, judge: c.you, result: approve ? "approved" : "rejected", at: Date.now() } : r)),
                }
              : t
          ),
        })),
      addTask: (code, title, owner) =>
        edit(code, (c) => {
          const id = Math.max(0, ...c.tasks.map((t) => t.id)) + 1
          const unfiled = c.taskGroups.some((g) => g.head.kind === "unfiled")
          return {
            ...c,
            taskGroups: unfiled
              ? c.taskGroups.map((g) => (g.head.kind === "unfiled" ? { ...g, tasks: [id, ...g.tasks] } : g))
              : [...c.taskGroups, { key: "unfiled", head: { kind: "unfiled" }, tasks: [id] }],
            tasks: [...c.tasks, { id, title, owner, status: "todo", createdBy: c.you, createdAt: Date.now(), updatedAt: Date.now(), notes: [], rounds: [], history: [], archived: false }],
          }
        }),
      setTaskStatus: (code, id, status) => editTask(code, id, (t) => ({ ...t, status, updatedAt: Date.now() })),
      cancelTask: (code, id, why) =>
        edit(code, (c, seq) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: "done",
                  cancelled: true,
                  youReview: undefined,
                  rounds: t.rounds.map((r) => (r.result === "open" ? { ...r, result: "withdrawn" } : r)),
                  updatedAt: Date.now(),
                  history: [...t.history, { seq, by: c.you, at: Date.now(), what: "cancelled", note: why }],
                }
              : t
          ),
        })),
      assignTask: (code, id, to, why) =>
        edit(code, (c, seq) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === id
              ? { ...t, owner: to, suggested: undefined, updatedAt: Date.now(), history: [...t.history, { seq, by: c.you, at: Date.now(), what: "assigned", to, ...(why ? { note: why } : {}) }] }
              : t
          ),
        })),
      nameGoal: (code, ask, name) =>
        edit(code, (c) => ({
          ...c,
          taskGroups: c.taskGroups.map((g) => (g.head.kind === "ask" && g.head.id === ask ? { ...g, head: { ...g.head, goal: name?.trim() || undefined } } : g)),
        })),
      setReviewer: (code, id, reviewer) =>
        edit(code, (c, seq) => ({
          ...c,
          tasks: c.tasks.map((t) => (t.id === id ? { ...t, reviewer, updatedAt: Date.now(), history: [...t.history, { seq, by: c.you, at: Date.now(), what: "reviewer", to: reviewer }] } : t)),
        })),
      setRole: (code, name, role) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, role: role ?? undefined } : p)) })),
      removeMember: (code, name) => edit(code, (c) => ({ ...c, people: c.people.filter((p) => p.name !== name) })),
      setPersona: (code, name, persona) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, persona: persona ?? undefined } : p)) })),
      setReadOnly: (code, name, on) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, readOnly: on } : p)) })),
      setWake: (code, name, on) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, wakes: on } : p)) })),
      setNickname: (code, name, nickname) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, display: nickname?.trim() || undefined } : p)) })),
      setPowers: (code, name, powers) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, ...powers } : p)) })),
      showAgent: async () => null,
      openTerm: (_code, _name, cols, rows, watch) => demoTerm(cols, rows, watch),
      openMyTerm: (_code, want, cols, rows, watch) => demoShell(want, cols, rows, watch),
      myTerms: async () => demoShells(),
      closeMyTerm: async (pane) => demoShells(pane),
      choicesOn: async (_code, computer) =>
        computer === "mbp"
          ? { folders: ["~/www/channels", "~/www/landing"] }
          : {
              harnesses: [
                { id: "codex", label: "Codex", installed: true },
                { id: "claude", label: "Claude Code", installed: false, why: "not installed" },
              ],
              folders: ["~/src/channels"],
            },
      chooseFolder: async () => "~/www/picked",
      addAgent: (code, a, seen) => {
        let following = true
        const tell = (s: Launching) => following && seen(s)
        window.setTimeout(() => tell({ stage: "started" }), 800)
        window.setTimeout(() => tell({ stage: "asked", name: a.name }), 1600)
        window.setTimeout(() => {
          tell({ stage: "joined", name: a.name })
          edit(code, (c) => ({
            ...c,
            people: [
              ...c.people,
              {
                name: a.name,
                kind: "agent",
                owner: false,
                you: false,
                presence: "online",
                harness: a.harness,
                runs: HARNESSES.find((h) => h.id === a.harness)?.label,
                machine: DEMO_ACCOUNT.computers.find((m) => m.id === a.computer)?.label ?? a.computer,
                persona: PERSONAS.find((p) => p.id === a.persona)?.label ?? a.persona,
                role: a.role,
                sponsor: c.you,
                lastSeen: Date.now(),
                joined: Date.now(),
                messages: 0,
              },
            ],
          }))
        }, 2400)
        return () => {
          following = false
        }
      },
      addRoom: (code, name, members) => {
        edit(code, (c) => ({ ...c, rooms: [...c.rooms, { id: name, name, unread: 0, mentions: 0, ...(members?.length ? { members: ["jow", ...members] } : {}) }] }))
        return Promise.resolve(name)
      },
      setGithubWrite: (code, on) => edit(code, (c) => ({ ...c, githubWrite: on || undefined })),
      setBranchPrefix: (code, prefix) => edit(code, (c) => ({ ...c, branchPrefix: prefix?.trim() || undefined })),
      setRoomMembers: (code, id, members) => edit(code, (c) => ({ ...c, rooms: c.rooms.map((r) => (r.id === id ? { ...r, members } : r)) })),
      renameRoom: (code, id, name) => edit(code, (c) => ({ ...c, rooms: c.rooms.map((r) => (r.id === id ? { ...r, name: name.trim().replace(/^#/, "") } : r)) })),
      setIcon: (code, file) => {
        const icon = file ? URL.createObjectURL(file) : undefined
        edit(code, (c) => ({ ...c, icon }))
        setState((s) => ({ ...s, tiles: s.tiles.map((t) => (t.code === code ? { ...t, icon } : t)) }))
      },
      exportHistory: async (code, kind) => announce(`Saved ${code} ${kind === "log" ? "log.jsonl" : "transcript.md"} to Downloads`),
      clearFact: (code, key) => edit(code, (c) => ({ ...c, facts: c.facts?.filter((f) => f.key !== key) })),
      renameChannel: (code, title) => {
        edit(code, (c) => ({ ...c, title }))
        setState((s) => ({ ...s, tiles: s.tiles.map((t) => (t.code === code ? { ...t, title } : t)) }))
      },
      setGoal: (code, goal) => edit(code, (c) => ({ ...c, goal: goal || undefined })),
      setHold: (code, on, note) => edit(code, (c) => ({ ...c, hold: on ? { note, by: c.you, at: Date.now() } : undefined })),
      askCompact: (code) => edit(code, (c) => (c.proposal ? c : withCompact(c, false))),
      approveCompact: (code, proposal) => edit(code, (c) => (c.proposal?.seq === proposal ? { ...c, compact: { ...c.proposal, by: c.you, at: Date.now() }, proposal: undefined } : c)),
      myRepos: async () => ["kiwi-init/channels", "kiwi-init/electrobun-livewire", "kiwi-init/landing", "ojowwalker77/dotfiles"],
      addRepo: (code, repo) => edit(code, (c) => ({ ...c, repos: [...new Set([...c.repos, repo])] })),
      removeRepo: (code, repo) => edit(code, (c) => ({ ...c, repos: c.repos.filter((r) => r !== repo) })),
      joinCommand: async (code, as) =>
        inviteLine("https://channels.kiwiinit.com", `${code}-x7Qp2LmR`, {
          ...(as.nick ? { nick: as.nick } : {}),
          persona: as.persona
            ? "eyJyb29tIjoicjdLcTJtWGEiLCJwaW4iOnsiaWQiOiJsZWFkIiwibmFtZSI6IkxlYWQiLCJoYXNoIjoiOGYzYTYxYzI5ZDRlMGI3MWE1YzhmMDNkMmU5YjZhNDcifSwicGsiOiJRbTl2TFhCckxXVjRZVzF3YkdVdFptOXlMV1JsYlc4dGIyNXNlUzB3TVEiLCJzaWciOiJjMmxuYm1GMGRYSmxMV1Y0WVcxd2JHVXRabTl5TFdSbGJXOHRiMjVzZVMxdWIzUXRjbVZoYkMwd01USXpORFUyTnpnNVlXSmpaR1ZtIn0"
            : null,
        }),
      inviteLink: async (code) => `https://channels.kiwiinit.com/#${code}-x7Qp2LmR`,
      leaveChannel: (code) => setState((s) => ({ ...s, tiles: s.tiles.filter((t) => t.code !== code) })),
      newChannel: async (title) => {
        const code = title.toLowerCase().replace(/[^a-z0-9]+/g, "-")
        setState((s) => {
          const channels = new Map(s.channels)
          channels.set(code, { ...DEMO_EMPTY, code, title })
          return { ...s, channels, tiles: [...s.tiles, { code, title, state: "member", unread: 0, needsYou: 0, last: Date.now() }] }
        })
        return code
      },
      inviteInfo: async (typed) => {
        const code = typed
          .trim()
          .replace(/^kiwi:\/\/join\//, "")
          .replace(/^https?:\/\/\S*#/, "")
        if (code.includes("gone")) return { code, owner: null, state: "gone" }
        return { code, owner: "maya", state: "ok" }
      },
      joinChannel: async (code) => {
        setState((s) => {
          const channels = new Map(s.channels)
          channels.set(code, { ...DEMO_WAITING, code, title: "maya's channel", waiting: { code: "", since: Date.now(), owner: "maya" } })
          return { ...s, channels, tiles: [...s.tiles, { code, title: code, state: "waiting", unread: 0, needsYou: 0, last: Date.now() }] }
        })
        return code
      },
      setName: (name) => setState((s) => (s.account ? { ...s, account: { ...s.account, name } } : { ...s, account: { ...DEMO_ACCOUNT, name } })),
      setPrefs: (p) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...p } })),
      setMute: (code, room, on) => {
        setState((s) => {
          const key = muteKey(code, room)
          const rest = s.prefs.muted.filter((k) => k !== key)
          return { ...s, prefs: { ...s.prefs, muted: on ? [...rest, key] : rest } }
        })
        if (room)
          edit(code, (c) => ({
            ...c,
            rooms: c.rooms.map((r) =>
              r.id !== room ? r : on ? { ...r, muted: true as const } : { id: r.id, name: r.name, unread: r.unread, mentions: r.mentions, ...(r.members ? { members: r.members } : {}) }
            ),
          }))
      },
      snooze: (until) => setState((s) => ({ ...s, prefs: { ...s.prefs, snoozeUntil: until ? snoozeEnd(until, Date.now()) : null } })),
      forgetComputer: (id) => setState((s) => (s.account ? { ...s, account: { ...s.account, computers: s.account.computers.filter((c) => c.id !== id) } } : s)),
      linkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: { login: "ojowwalker77" } } } : s)),
      unlinkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: undefined } } : s)),
      applyUi: () => setState((s) => (s.account ? { ...s, account: { ...s.account, uiUpdate: undefined } } : s)),
      windowControl: () => {},
      checkUpdate: async () => ({ state: "current", version: "2026.10.8" }),
      setRelay: async (url) => (/^https?:\/\//.test(url.trim()) ? null : "a relay is an http(s) address"),
      installUpdate: () => setState((s) => (s.account?.update ? { ...s, account: { ...s.account, version: s.account.update.version, update: undefined } } : s)),
      signOut: () => setState((s) => ({ ...s, account: null, tiles: [] })),
      setNewMembers: (code, can) => edit(code, (c) => ({ ...c, newMembers: can })),
      setNewPowers: (code, powers) => edit(code, (c) => ({ ...c, newPowers: powers })),
      closeChannel: (code) => setState((s) => ({ ...s, tiles: s.tiles.filter((t) => t.code !== code) })),
      enrollAnswer: () => setState((s) => (s.account?.enrollAsk ? { ...s, account: { ...s.account, enrollAsk: { ...s.account.enrollAsk, stage: "digits" } } } : s)),
      enrollConfirm: async (_id, digits) => {
        if (digits !== "482913") return { ok: false, left: 2 }
        setState((s) => (s.account ? { ...s, account: { ...s.account, enrollAsk: undefined } } : s))
        return { ok: true }
      },
      forgetDevice: (id) => setState((s) => (s.account ? { ...s, account: { ...s.account, devices: s.account.devices?.filter((d) => d.id !== id) } } : s)),
      renewDevice: (id) =>
        setState((s) => (s.account ? { ...s, account: { ...s.account, devices: s.account.devices?.map((d) => (d.id === id ? { ...d, until: Date.now() + 90 * 86_400_000 } : d)) } } : s)),
      recoveryWords: async () => DEMO_WORDS,
      recoverySave: async (typed) => {
        const wrong = typed.filter((t) => t.word.trim().toLowerCase() !== DEMO_WORDS[t.at]).map((t) => t.at)
        if (wrong.length) return { ok: false, wrong }
        setState((s) => (s.account ? { ...s, account: { ...s.account, recovery: { at: Date.now(), here: true } } } : s))
        return { ok: true }
      },
      recoveryDrop: () => {},
      signInWithGithub: () => {
        setState((s) => ({ ...s, signIn: { stage: "sign-in", code: { code: "8F3A-29KD", url: "https://github.com/login/device" }, problem: null } }))
        setTimeout(() => setState((s) => (s.signIn ? { ...s, signIn: s.account ? null : { stage: "signed-in", login: "ojowwalker77" } } : s)), 1500)
      },
      enrollBegin: () => {
        setState((s) => ({ ...s, enrolling: { stage: "asking" } }))
        setTimeout(() => setState((s) => (s.enrolling ? { ...s, enrolling: { stage: "digits", digits: "482915" } } : s)), 1500)
      },
      enrollKeep: () => setState((s) => ({ ...s, enrolling: null })),
      enrollCancel: () => setState((s) => ({ ...s, enrolling: null })),
      enrollDeny: () => setState((s) => (s.account ? { ...s, account: { ...s.account, enrollAsk: undefined } } : s)),
      saveTheme: (theme) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...savedTheme(s.prefs, theme) } })),
      deleteTheme: (id) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...deletedTheme(s.prefs, id) } })),
      addStartFolder: () => setStarts((s) => (s.folders.includes("~/code/kiwi") ? s : { ...s, folders: [...s.folders, "~/code/kiwi"] })),
      removeStartFolder: (dir) => setStarts((s) => ({ ...s, folders: s.folders.filter((f) => f !== dir) })),
      allowNewAgents: (on) => setStarts((s) => ({ ...s, launch: on })),
      allowRemoteBypass: (on) => setStarts((s) => ({ ...s, bypass: on })),
      savePersonalities: setOwnPersonalities,
      setHooks: (harness, on) => setComputer((c) => ({ ...c, hooks: c.hooks.map((h) => (h.harness === harness ? { ...h, state: on ? "installed" : "off" } : h)) })),
      setTerminalHelpers: (id, on) => setStarts((s) => ({ ...s, terminals: s.terminals.map((t) => (t.id === id ? { ...t, helpers: on ? "on" : "off" } : t)) })),
      setContextLine: (on) => setComputer((c) => ({ ...c, contextLine: on })),
      computerSettings: () =>
        new Promise((done) =>
          setTimeout(
            () =>
              done([
                ["New agents", ["Allowed"]],
                ["Bypass from your other devices", ["Off"]],
                ["Hooks", ["Claude Code on", "Codex out of date"]],
                ["Agents", ["builder in kiwi, wakes on a message"]],
              ]),
            400
          )
        ),
      checkComputer: () => new Promise((done) => setTimeout(() => done(FINDINGS), 400)),
    }
  }, [])

  return {
    account: state.account,
    channels: state.tiles,
    channel: open && state.gone?.code !== open ? (state.channels.get(open) ?? null) : null,
    ...(state.gone && state.gone.code === open ? { gone: state.gone } : {}),
    prefs: state.prefs,
    harnesses: HARNESSES,
    personas: PERSONAS,
    starts,
    ownPersonalities,
    computer,
    enrolling: state.enrolling ?? null,
    signIn: state.signIn ?? null,
    actions,
  }
}
