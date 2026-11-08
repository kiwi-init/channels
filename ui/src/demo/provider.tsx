import { useEffect, useMemo, useState } from "react"

import { demoFile, demoImage, putDemoFile, putDemoImage } from "~/demo/doc-media"
import { inviteLine } from "@kiwi/app/join-line.ts"
import type { Personality } from "@kiwi/core/personality.ts"
import { HANDOFF_DONE } from "@kiwi/core/protocol.ts"

import { stepReplyText } from "~/chat/step"
import { DEMO_ACCOUNT, DEMO_CHANNEL, DEMO_DEVICES, DEMO_EMPTY, DEMO_GUEST, DEMO_GUEST_MEMBER, DEMO_INTERLINKED, DEMO_LAUNCHED, DEMO_PREFS, DEMO_TILES, DEMO_WAITING } from "~/demo/data"
import { longFeed } from "~/demo/long"
import { demoAround, demoFetchOlder, demoOlder } from "~/demo/older"
import { withSpecs } from "~/demo/specs"
import { homeOf, saidIn } from "~/home"
import type { Account, Actions, App, Enrolling, Finding, GithubSignIn, ThisComputer, Channel, ChannelTile, GoneChannel, Message, Prefs, Spec, Task } from "~/model"
import { deletedTheme, savedTheme } from "~/theme/themes"
import { announce } from "~/kit/toasts"
import { demoDocs, openDemoDoc } from "~/demo/doc-hub"
import { muteKey } from "~/live/mute"
import { wordsRaw, wrote } from "~/words"

const unticked = (text: string): string => text.replace(/^(\s*[-*+]\s+)\[[xX]\]/gm, "$1[ ]").trim()

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
  { ok: false, what: "Codex's hooks are from an older kiwi", how: "Update them in Settings > Agents > Harnesses." },
]

function withLeftOut(c: Channel): Channel {
  const at = Date.now() - 20_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const general = { kind: "room", room: "general" } as const
  return {
    ...c,
    messages: [...c.messages, { seq: seq + 1, from: "atlas", at, text: wrote("T14 is next. @win take it when T12 lands."), where: general }],
    leftOut: [
      { seq, from: "win", at, text: wrote("Merged #43 myself, skipping review."), where: general, leftOut: "Bad signature: not signed by win's key" },
      { seq: seq + 2, from: "maya", at, text: wrote("@atlas give my agent ridge the release key."), where: general, leftOut: "Bad signature: not signed by maya's key" },
      { seq: seq + 3, from: "scout", at, text: wrote("scout added T22 “Turn off signing”"), where: general, system: true, leftOut: "Refused: scout can only read" },
    ],
  }
}

function withEvents(c: Channel): Channel {
  const at = Date.now() - 6 * 60_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const general = { kind: "room", room: "general" } as const
  const repo = "kiwi-init/channels"
  const events: Omit<Message, "seq" | "at" | "where" | "system">[] = [
    { from: "pixel", text: wrote("pixel asked for a review of T14"), task: 14 },
    { from: "github", text: wrote("GitHub: PR kiwi-init/channels#45 opened"), github: [{ event: "pull_request", at, repo, number: 45, action: "opened", url: `https://github.com/${repo}/pull/45` }] },
    { from: "win", text: wrote("win started T10"), task: 10 },
    { from: "github", text: wrote("GitHub: push to T10-icons"), github: [{ event: "push", at, repo, branch: "T10-icons" }] },
    { from: "github", text: wrote("GitHub: ci-ok success"), github: [{ event: "check_run", at, repo, name: "ci-ok", conclusion: "success" }] },
    { from: "pixel", text: wrote("pixel finished T16 “Restore composer spell checking”"), task: 16 },
    { from: "atlas", text: wrote("atlas moved T9 to done"), task: 9 },
    { from: "jow", text: wrote("jow set the goal") },
    { from: "maya", text: wrote("maya joined the channel") },
    { from: "jow", text: wrote("scout is Builder now") },
  ]
  return {
    ...c,
    messages: [
      ...c.messages,
      ...events.map((e, i) => ({ ...e, seq: seq + i, at: at + i * 20_000, where: general, system: true })),
      { seq: seq + events.length, from: "atlas", at: at + events.length * 20_000, text: wrote("T9 and T16 are in. T10 is next."), where: general },
    ],
  }
}

function withEventRuns(c: Channel): Channel {
  const at = Date.now() - 900 * 20_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const general = { kind: "room", room: "general" } as const
  const repo = "kiwi-init/channels"
  return {
    ...c,
    messages: [
      ...c.messages,
      ...Array.from({ length: 900 }, (_, i): Message =>
        i % 12 === 11
          ? { seq: seq + i, from: "atlas", at: at + i * 20_000, text: wrote(`Run ${(i + 1) / 12} is green.`), where: general }
          : {
              seq: seq + i,
              from: "github",
              at: at + i * 20_000,
              text: wrote(`GitHub: push to T${i % 7}-work`),
              github: [{ event: "push", at: at + i * 20_000, repo, branch: `T${i % 7}-work` }],
              where: general,
              system: true,
            }
      ),
    ],
  }
}

function withTaskEvents(c: Channel): Channel {
  const at = Date.now() - 300 * 20_000
  const seq = Math.max(...c.messages.map((m) => m.seq)) + 1
  const where = { kind: "task", task: 10 } as const
  const repo = "kiwi-init/channels"
  return {
    ...c,
    messages: [
      ...c.messages,
      ...Array.from({ length: 300 }, (_, i) =>
        i % 4 === 0
          ? { seq: seq + i, from: "win", at: at + i * 20_000, text: wrote(`Pushed ${i / 4 + 1} of the icon sprite.`), where }
          : {
              seq: seq + i,
              from: "github",
              at: at + i * 20_000,
              text: wrote("GitHub: ci-ok success on T10-icons"),
              where,
              system: true,
              github: [{ event: "check_run" as const, at: at + i * 20_000, repo, name: "ci-ok", conclusion: "success" }],
            }
      ),
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
      { seq, from: "win", at, text: wrote(text), where: { kind: "room", room: "general" }, ask: "step-1", mentionsYou: true },
      { seq: seq + 1, from: "atlas", at, text: wrote(free), where: { kind: "room", room: "general" }, ask: "q-free", mentionsYou: true },
    ],
    asks: [
      ...c.asks,
      {
        kind: "question",
        id: "step-1",
        from: "win",
        at,
        text: wrote(text),
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
      { kind: "question", id: "q-free", from: "atlas", at, text: wrote(free), label: "Question for everyone", options: [], holds: [11] },
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
    messages: [...c.messages, ...said.map((h, i) => ({ seq: seq + i, from: h.from, at: at + i * 1_000, text: wrote(h.text), where: room, ask: h.id, mentionsYou: true }))],
    asks: [
      ...c.asks,
      ...said.map((h, i) => ({
        kind: "question" as const,
        id: h.id,
        from: h.from,
        at: at + i * 1_000,
        text: wrote(h.text),
        label: "Browser for you",
        options: [],
        holds: [13],
        handoff: { url: h.url, label: h.label, expiresAt: Date.now() + h.expires },
        ...(h.id === "handoff-done" ? { answer: { text: wrote(HANDOFF_DONE), by: c.you, at: Date.now() - 60_000, shownIn: "card" as const } } : {}),
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
    return {
      ...c,
      proposal: { summary: COMPACT_SUMMARY, through, by: "atlas", at, seq },
      messages: [...c.messages, { ...said, text: wrote(`atlas proposed compacting the history through #${through}`) }],
    }
  return {
    ...c,
    compact: { summary: COMPACT_SUMMARY, through, by: c.you, at, seq },
    messages: [...c.messages, { ...said, from: c.you, text: wrote(`jow compacted the history through #${through}`) }],
  }
}

export type Scenario =
  | "full"
  | "compact"
  | "compacted"
  | "long"
  | "step"
  | "asked-of"
  | "left-out"
  | "events"
  | "task-events"
  | "ci-live"
  | "doc-busy"
  | "event-runs"
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
  | "update-downloading"
  | "update-blocked"
  | "update-moved"
  | "update-moved-mac"
  | "enroll"
  | "enroll-digits"
  | "devices"
  | "enroll-desktop"
  | "enroll-desktop-digits"
  | "enroll-desktop-check"
  | "devices-forgotten"
  | "forgot-here"
  | "link-stuck"
  | "github-sign-in"
  | "github-code"
  | "github-signed-in"
  | "github-gate"
  | "specs"
  | "spec-changed"
  | "forgotten-computer"
  | "member"

function initial(scenario: Scenario, look: Partial<Prefs>): State {
  const prefs = { ...DEMO_PREFS, ...look }
  const channels = new Map(
    [
      scenario === "long"
        ? longFeed(DEMO_CHANNEL)
        : scenario === "step"
          ? withStep(DEMO_CHANNEL)
          : scenario === "asked-of"
            ? { ...DEMO_CHANNEL, asks: DEMO_CHANNEL.asks.map((a) => (a.kind === "question" ? { ...a, label: a.label.replace(/ for you$/, ""), askedOf: ["maya"] } : a)) }
            : scenario === "left-out"
              ? withLeftOut(DEMO_CHANNEL)
              : scenario === "events" || scenario === "ci-live"
                ? withEvents(DEMO_CHANNEL)
                : scenario === "task-events"
                  ? withTaskEvents(DEMO_CHANNEL)
                  : scenario === "handoff"
                    ? withHandoff(DEMO_CHANNEL)
                    : scenario === "opening"
                      ? { ...DEMO_CHANNEL, messages: [], tasks: [], asks: [], connection: "connecting" as const, loading: true }
                      : scenario === "held"
                        ? { ...DEMO_CHANNEL, hold: { note: "Waiting on the release key.", by: "jow", at: Date.now() - 40 * 60_000 } }
                        : scenario === "compact" || scenario === "compacted"
                          ? withCompact(DEMO_CHANNEL, scenario === "compacted")
                          : scenario === "specs" || scenario === "spec-changed"
                            ? withSpecs(DEMO_CHANNEL, scenario === "spec-changed")
                            : scenario === "forgotten-computer"
                              ? {
                                  ...DEMO_CHANNEL,
                                  asks: [
                                    {
                                      kind: "join" as const,
                                      id: "join-dudu",
                                      at: Date.now() - 30 * 60_000,
                                      name: "dudu",
                                      who: "agent" as const,
                                      harness: "claude" as const,
                                      runs: "Claude Code · claude-opus-5-5",
                                      machine: "MacBook-Pro-de-Davi",
                                      sponsor: "harry",
                                      revoked: true as const,
                                      said: { machine: "macOS arm64 · 10 cores · 16 GB", repo: "Davi-Vicente/D2N@main", outside: true },
                                      code: "604-218",
                                    },
                                    ...DEMO_CHANNEL.asks,
                                  ],
                                }
                              : scenario === "event-runs"
                                ? withEventRuns(DEMO_CHANNEL)
                                : DEMO_CHANNEL,
      DEMO_EMPTY,
      DEMO_WAITING,
      DEMO_INTERLINKED,
      scenario === "member" ? DEMO_GUEST_MEMBER : DEMO_GUEST,
    ].map((c) => [c.code, { ...c, docs: demoDocs(c.code) }])
  )
  if (scenario === "updates")
    return { account: { ...DEMO_ACCOUNT, uiUpdate: { version: "dev-1542" }, update: { version: "2026.10.7", ready: true, state: "ready" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-ready") return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.7", ready: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "link-stuck") return { account: { ...DEMO_ACCOUNT, enrollError: "this app isn't in your device list any more" }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-downloading")
    return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.8", ready: false, state: "downloading", progress: 0.42 } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-blocked")
    return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.8", ready: false, state: "available", blocked: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-moved")
    return {
      account: { ...DEMO_ACCOUNT, moved: { from: "/opt/channels/Channels-2026.10.15-x86_64.AppImage", to: "~/Applications/Channels.AppImage" } },
      tiles: DEMO_TILES,
      channels,
      prefs,
      seq: 1000,
    }
  if (scenario === "update-moved-mac") return { account: { ...DEMO_ACCOUNT, moved: { to: "/Applications/Channels.app" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-available") return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.8", ready: false, state: "available" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "enroll" || scenario === "enroll-digits")
    return {
      account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES, enrollAsk: { id: "demo-ask", label: "Jow's MacBook Air", os: "macOS", as: "desktop", stage: scenario === "enroll" ? "new" : "digits" } },
      tiles: DEMO_TILES,
      channels,
      prefs,
      seq: 1000,
    }
  if (scenario === "devices") return { account: { ...DEMO_ACCOUNT, devices: DEMO_DEVICES }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
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
  const [ownPersonalities, setOwnPersonalities] = useState<Personality[]>([])
  const [computer, setComputer] = useState(COMPUTER)

  useEffect(() => {
    if (scenario !== "ci-live") return
    const repo = "kiwi-init/channels"
    const names = ["test / unit", "repo / static", "build / shots", "ci-ok"]
    let n = 0
    const timer = window.setInterval(() => {
      const at = Date.now()
      const name = names[n++ % names.length] ?? "ci-ok"
      setState((s) => {
        const c = s.channels.get("kiwi")
        if (!c) return s
        const channels = new Map(s.channels)
        const seq = s.seq + 1
        channels.set("kiwi", {
          ...c,
          messages: [
            ...c.messages,
            {
              seq,
              from: "github",
              at,
              text: wrote(`GitHub: ${name} success on T10-icons`),
              where: { kind: "room", room: "general" },
              system: true,
              github: [{ event: "check_run", at, repo, name, conclusion: "success" }],
            },
          ],
        })
        return { ...s, channels, seq }
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [scenario])

  useEffect(() => {
    if (scenario !== "doc-busy") return
    let n = 0
    const timer = window.setInterval(() => {
      n++
      setState((s) => {
        const c = s.channels.get("kiwi")
        if (!c) return s
        const channels = new Map(s.channels)
        const seq = s.seq + 1
        const text = n % 3 ? `Step ${n} is done.` : `Step ${n} is done.\nThe next one takes longer: it rebuilds the icons and measures the first load again.`
        channels.set("kiwi", { ...c, messages: [...c.messages, { seq, from: n % 2 ? "atlas" : "win", at: Date.now(), text: wrote(text), where: { kind: "task", task: 10 } }] })
        return { ...s, channels, seq }
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [scenario])

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
          const next = post(c, seq, {
            from: c.you,
            text: wrote(text),
            where,
            replyTo,
            inThread: root,
            pending: true,
            canChange: true,
            ...(root !== undefined && opts?.side ? { side: true as const } : {}),
            ...(images?.length ? { images } : {}),
            ...(opts?.block ? { block: opts.block.id } : {}),
          })
          if (root === undefined) return next
          return {
            ...next,
            messages: next.messages.map((m) =>
              m.seq === root ? { ...m, thread: { replies: (m.thread?.replies ?? 0) + 1, last: Date.now(), people: [...new Set([...(m.thread?.people ?? []), c.you])] } } : m
            ),
          }
        })
        window.setTimeout(() => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === sent ? { ...m, pending: undefined } : m)) })), 700)
        return Promise.resolve(true)
      },
      retry: (code, seq) => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === seq ? { ...m, failed: undefined } : m)) })),
      loadImage: () => {},
      openDoc: (code, thread, th, on) => openDemoDoc(code, thread, th, on),
      findDoc: async () => null,
      docVersions: async () => {
        const now = Date.now()
        return [3, 26, 50, 75].map((hours, i) => ({ upto: 40 - i * 9, ts: now - hours * 3_600_000, bytes: 52_000 - i * 9_400 }))
      },
      restoreDocVersion: () => new Promise((done) => window.setTimeout(() => done(true), 600)),
      putDocImage: (_code, upload) => putDemoImage(upload),
      putDocFile: (_code, upload) => putDemoFile(upload),
      docImage: (_code, img) => demoImage(img),
      docFile: (_code, f) => demoFile(f),
      setAgentColor: (code, name, color) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, color: color ?? undefined } : p)) })),
      leaveRoom: (code, room) => edit(code, (c) => ({ ...c, rooms: c.rooms.filter((r) => r.id !== room) })),
      markRead: (code, where) =>
        edit(code, (c) => ({
          ...c,
          rooms: where.kind === "room" ? c.rooms.map((r) => (r.id === where.room ? { ...r, unread: 0, mentions: 0 } : r)) : c.rooms,
          directs: where.kind === "dm" ? c.directs.map((d) => (d.with === where.with ? { ...d, unread: 0 } : d)) : c.directs,
        })),
      followThread: (code, root, on) => edit(code, (c) => ({ ...c, follows: { ...c.follows, [root]: on }, threads: (c.threads ?? []).map((t) => (t.root === root ? { ...t, following: on } : t)) })),
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
      editMessage: (code, seq, text) => edit(code, (c) => ({ ...c, messages: c.messages.map((m) => (m.seq === seq ? { ...m, text: wrote(text), edited: Date.now() } : m)) })),
      deleteMessage: (code, seq) =>
        edit(code, (c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.seq !== seq) return m
            return { ...m, text: wrote(""), images: undefined, canChange: undefined, edited: undefined, deleted: true as const }
          }),
        })),
      answerPermission: (code, id, allow) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.map((a) => (a.kind === "permission" && a.id === id ? { ...a, answer: { allow, by: c.you, at: Date.now() } } : a)),
          tasks: c.tasks.map((t) => (c.asks.some((a) => a.kind === "permission" && a.id === id && a.task === t.id) ? { ...t, status: allow ? "doing" : "todo" } : t)),
        })),
      answerStep: (code, id, reply) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.map((a) => (a.kind === "question" && a.id === id ? { ...a, answer: { text: wrote(stepReplyText(reply)), by: c.you, at: Date.now(), shownIn: "card" as const } } : a)),
        })),
      answerQuestion: (code, id, text) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.map((a) => (a.kind === "question" && a.id === id ? { ...a, answer: { text: wrote(text), by: c.you, at: Date.now(), shownIn: "card" as const } } : a)),
        })),
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
                  notes: why ? [...t.notes, { by: c.you, at: Date.now(), text: wrote(why) }] : t.notes,
                  rounds: t.rounds.map((r) => (r.result === "open" ? { ...r, judge: c.you, result: approve ? "approved" : "rejected", at: Date.now() } : r)),
                }
              : t
          ),
        })),
      addTask: (code, ask, title) =>
        edit(code, (c) => {
          const id = Math.max(0, ...c.tasks.map((t) => t.id)) + 1
          return {
            ...c,
            specs: c.specs?.map((sp) => (sp.ask === ask ? { ...sp, tasks: [...sp.tasks, id], stage: sp.stage === "queued" ? ("working" as const) : sp.stage, queue: undefined } : sp)),
            tasks: [
              ...c.tasks,
              {
                id,
                title: wrote(title),
                status: "todo",
                createdBy: c.you,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                notes: [],
                rounds: [],
                history: [{ seq: id, by: c.you, at: Date.now(), what: "created" }],
                archived: false,
              },
            ],
          }
        }),
      setSpecsOnly: (code, on) => edit(code, (c) => ({ ...c, specsOnly: on ? (true as const) : undefined })),
      setTaskStatus: (code, id, status) => editTask(code, id, (t) => ({ ...t, status, updatedAt: Date.now() })),
      editTask: (code, id, change) =>
        editTask(code, id, (t) => ({
          ...t,
          ...(change.title?.trim() ? { title: wrote(change.title.trim()) } : {}),
          ...(change.detail !== undefined ? { detail: change.detail.trim() ? wrote(change.detail.trim()) : undefined } : {}),
          updatedAt: Date.now(),
        })),
      deleteTask: (code, id) => edit(code, (c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== id) })),
      closeTask: (code, id, why) =>
        edit(code, (c) => ({
          ...c,
          tasks: c.tasks.map((t) => (t.id === id ? { ...t, status: "done", closedWith: wrote(why), updatedAt: Date.now() } : t)),
          asks: c.asks.filter((a) => !(a.kind === "bypass" && a.task === id)),
        })),
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
                  history: [...t.history, { seq, by: c.you, at: Date.now(), what: "cancelled", note: wrote(why) }],
                }
              : t
          ),
        })),
      assignTask: (code, id, to, why) =>
        edit(code, (c, seq) => ({
          ...c,
          tasks: c.tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  owner: to,
                  suggested: undefined,
                  updatedAt: Date.now(),
                  history: [...t.history, { seq, by: c.you, at: Date.now(), what: "assigned", to, ...(why ? { note: wrote(why) } : {}) }],
                }
              : t
          ),
        })),
      newSpec: (code, words, text) => {
        let made = 0
        edit(code, (c, seq) => {
          made = seq
          const at = Date.now()
          const title =
            text
              .split("\n")
              .find((l) => l.startsWith("# "))
              ?.slice(2) ?? words.slice(0, 80)
          const spec: Spec = {
            ask: seq,
            title: wrote(title),
            words: wrote(words.trim()),
            by: c.you,
            at,
            text: wrote(text),
            v: seq,
            edited: { by: c.you, at },
            edits: 1,
            editors: [c.you],
            stage: "draft",
            backs: [],
            comments: [],
            tasks: [],
            canJudge: true,
          }
          return { ...post(c, seq, { from: c.you, text: wrote(words.trim()), where: { kind: "room", room: "general" } }), specs: [...(c.specs ?? []), spec] }
        })
        return Promise.resolve(made || null)
      },
      writeSpec: (code, ask, text) =>
        edit(code, (c, seq) => ({
          ...c,
          specs: c.specs?.map((sp) => {
            if (sp.ask !== ask) return sp
            const changed = !!sp.approved && (!!sp.changed || !sp.canJudge) && unticked(wordsRaw(sp.approved.text)) !== unticked(text)
            const title =
              text
                .split("\n")
                .find((l) => l.startsWith("# "))
                ?.slice(2) ?? wordsRaw(sp.title)
            return {
              ...sp,
              text: wrote(text),
              title: wrote(title),
              v: seq,
              edits: sp.edits + 1,
              edited: { by: c.you, at: Date.now() },
              editors: sp.editors.includes(c.you) ? sp.editors : [...sp.editors, c.you],
              ...(changed ? { changed: true as const } : { changed: undefined }),
            }
          }),
        })),
      approveSpec: (code, ask, v) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.filter((a) => !(a.kind === "spec" && a.ask === ask && a.why !== "result")),
          specs: c.specs?.map((sp) =>
            sp.ask === ask && sp.v === v
              ? {
                  ...sp,
                  approved: { by: c.you, at: Date.now(), v, text: sp.text },
                  changed: undefined,
                  stage: sp.stage === "draft" ? ("queued" as const) : sp.stage,
                  queue: sp.tasks.length ? undefined : 1 + (c.specs ?? []).filter((x) => x.stage === "queued").length,
                }
              : sp
          ),
        })),
      deleteSpec: (code, ask) =>
        edit(code, (c) => {
          const under = new Set(c.specs?.find((sp) => sp.ask === ask)?.tasks ?? [])
          return {
            ...c,
            asks: c.asks.filter((a) => !(a.kind === "spec" && a.ask === ask)),
            specs: c.specs?.filter((sp) => sp.ask !== ask),
            tasks: c.tasks.map((t) => (under.has(t.id) && t.status !== "done" ? { ...t, status: "done" as const, cancelled: true, updatedAt: Date.now() } : t)),
          }
        }),
      judgeSpec: (code, ask, verdict, note) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.filter((a) => !(a.kind === "spec" && a.ask === ask)),
          specs: c.specs?.map((sp) =>
            sp.ask !== ask
              ? sp
              : verdict === "back"
                ? { ...sp, stage: "queued" as const, queue: 1, backs: [...sp.backs, { by: c.you, at: Date.now(), note: wrote(note ?? "") }] }
                : { ...sp, stage: verdict, result: { verdict, by: c.you, at: Date.now(), ...(note ? { note: wrote(note) } : {}) } }
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
      addRoom: (code, name, members) => {
        edit(code, (c) => ({ ...c, rooms: [...c.rooms, { id: name, name, unread: 0, mentions: 0, ...(members?.length ? { members: ["jow", ...members] } : {}) }] }))
        return Promise.resolve(name)
      },
      setGithubWrite: (code, on) => edit(code, (c) => ({ ...c, githubWrite: on || undefined })),
      setBranchPrefix: (code, prefix) => edit(code, (c) => ({ ...c, branchPrefix: prefix?.trim() || undefined })),
      setLanding: (code, then) => edit(code, (c) => ({ ...c, landing: then?.trim() && then.trim() !== "none" ? then.trim() : undefined })),
      setPeopleMerge: (code, on) => edit(code, (c) => ({ ...c, peopleMerge: on ? true : undefined })),
      setRoomMembers: async (code, id, members) => {
        edit(code, (c) => ({ ...c, rooms: c.rooms.map((r) => (r.id === id ? { ...r, members } : r)) }))
        return true
      },
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
      searchOlder: async (...[, query, before]: Parameters<Actions["searchOlder"]>) => demoOlder(query, before),
      olderAround: async (...[, seq]: Parameters<Actions["olderAround"]>) => demoAround(seq),
      fetchOlder: (...[, got]: Parameters<Actions["fetchOlder"]>) => demoFetchOlder(got),
      earlier: async () => false,
      earlierTo: async () => false,
      holdEarlier: () => {},
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
      forgetComputer: (id) => setState((s) => (s.account ? { ...s, account: { ...s.account, computers: s.account.computers.filter((c) => c.id !== id) } } : s)),
      linkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: { login: "ojowwalker77" } } } : s)),
      unlinkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: undefined } } : s)),
      applyUi: () => setState((s) => (s.account ? { ...s, account: { ...s.account, uiUpdate: undefined } } : s)),
      dismissMoved: () => setState((s) => (s.account ? { ...s, account: { ...s.account, moved: undefined } } : s)),
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
      forgetDevice: (ids) => setState((s) => (s.account ? { ...s, account: { ...s.account, devices: s.account.devices?.filter((d) => !ids.includes(d.id)) } } : s)),
      renewDevice: (...ids) =>
        setState((s) => (s.account ? { ...s, account: { ...s.account, devices: s.account.devices?.map((d) => (ids.includes(d.id) ? { ...d, until: Date.now() + 90 * 86_400_000 } : d)) } } : s)),
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
      savePersonalities: setOwnPersonalities,
      setHooks: (harness, on) => setComputer((c) => ({ ...c, hooks: c.hooks.map((h) => (h.harness === harness ? { ...h, state: on ? "installed" : "off" } : h)) })),
      setContextLine: (on) => setComputer((c) => ({ ...c, contextLine: on })),
      launchedFrom: async (ids) => DEMO_LAUNCHED.filter((a) => ids.includes(a.from)),
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
      myUsage: async () => ({ plan: "free", blocked: false, used: 412, limit: 500, channels: 2, resetsAt: Date.now() + 5 * 3_600_000, upgradeUrl: "https://channels.kiwiinit.com/upgrade" }),
    }
  }, [])

  const home = useMemo(() => [...state.channels.values()].map((c) => homeOf(c, saidIn(c.messages))), [state.channels])

  return {
    account: state.account,
    channels: state.tiles,
    home,
    channel: open && state.gone?.code !== open ? (state.channels.get(open) ?? null) : null,
    ...(state.gone && state.gone.code === open ? { gone: state.gone } : {}),
    prefs: state.prefs,
    harnesses: HARNESSES,
    personas: PERSONAS,
    ownPersonalities,
    computer,
    enrolling: state.enrolling ?? null,
    signIn: state.signIn ?? null,
    actions,
  }
}
