import { useMemo, useState } from "react"

import { DEMO_ACCOUNT, DEMO_CHANNEL, DEMO_EMPTY, DEMO_GUEST, DEMO_PREFS, DEMO_TILES, DEMO_WAITING } from "~/demo/data"
import { longFeed } from "~/demo/long"
import type { Account, Actions, App, Channel, ChannelTile, Message, Prefs, Task } from "~/model"
import { deletedTheme, savedTheme } from "~/theme/themes"

interface State {
  account: Account | null
  tiles: ChannelTile[]
  channels: Map<string, Channel>
  prefs: Prefs
  seq: number
}

const HARNESSES: App["harnesses"] = [
  { id: "claude", label: "Claude Code", installed: true },
  { id: "codex", label: "Codex", installed: true },
  { id: "opencode", label: "OpenCode", installed: false },
  { id: "gemini", label: "Gemini CLI", installed: false },
]

const PERSONAS: App["personas"] = [
  { id: "lead", label: "Lead", about: "Plans the work, hands out tasks, reviews and merges." },
  { id: "builder", label: "Builder", about: "Takes a task, ships a small PR, moves on." },
  { id: "reviewer", label: "Reviewer", about: "Reads every PR closely and says what would break." },
  { id: "designer", label: "Designer", about: "Owns how it looks: shots on every PR, no slop." },
]

export type Scenario = "full" | "long" | "signed-out" | "no-channels" | "updates" | "update-ready"

function initial(scenario: Scenario, look: Partial<Prefs>): State {
  const prefs = { ...DEMO_PREFS, ...look }
  const channels = new Map(
    [scenario === "long" ? longFeed(DEMO_CHANNEL) : DEMO_CHANNEL, DEMO_EMPTY, DEMO_WAITING, { ...DEMO_EMPTY, code: "interlinked", title: "interlinked" }, DEMO_GUEST].map((c) => [c.code, c])
  )
  if (scenario === "updates")
    return { account: { ...DEMO_ACCOUNT, uiUpdate: { version: "dev-1542" }, update: { version: "2026.10.7", ready: true, state: "ready" } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "update-ready") return { account: { ...DEMO_ACCOUNT, update: { version: "2026.10.7", ready: true } }, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
  if (scenario === "signed-out") return { account: null, tiles: [], channels: new Map(), prefs, seq: 1000 }
  if (scenario === "no-channels") return { account: DEMO_ACCOUNT, tiles: [], channels: new Map(), prefs, seq: 1000 }
  return { account: DEMO_ACCOUNT, tiles: DEMO_TILES, channels, prefs, seq: 1000 }
}

export function useDemo(scenario: Scenario, open: string | null, look: Partial<Prefs> = {}): App {
  const [state, setState] = useState(() => initial(scenario, look))

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
          const next = post(c, seq, { from: c.you, text, where, replyTo, inThread: root, pending: true })
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
      answerPermission: (code, id, allow) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.map((a) => (a.kind === "permission" && a.id === id ? { ...a, answer: { allow, by: c.you, at: Date.now() } } : a)),
          tasks: c.tasks.map((t) => (c.asks.some((a) => a.kind === "permission" && a.id === id && a.task === t.id) ? { ...t, status: allow ? "doing" : "todo" } : t)),
        })),
      answerQuestion: (code, id, text) => edit(code, (c) => ({ ...c, asks: c.asks.map((a) => (a.kind === "question" && a.id === id ? { ...a, answer: { text, by: c.you, at: Date.now() } } : a)) })),
      answerJoin: (code, id, letIn) =>
        edit(code, (c) => {
          const ask = c.asks.find((a) => a.kind === "join" && a.id === id)
          const asks = c.asks.map((a) => (a.kind === "join" && a.id === id ? { ...a, answer: { letIn, by: c.you, at: Date.now() } } : a))
          if (!ask || ask.kind !== "join" || !letIn) return { ...c, asks }
          return {
            ...c,
            asks,
            people: [
              ...c.people,
              {
                name: ask.name,
                kind: ask.who,
                owner: false,
                you: false,
                presence: "online",
                typing: false,
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
      approveTask: (code, id, approve) =>
        edit(code, (c) => ({
          ...c,
          asks: c.asks.filter((a) => !(a.kind === "review" && a.task === id)),
          tasks: c.tasks.map((t) =>
            t.id === id ? { ...t, status: approve ? "done" : "doing", rounds: t.rounds.map((r) => (r.result === "open" ? { ...r, result: approve ? "approved" : "rejected", at: Date.now() } : r)) } : t
          ),
        })),
      addTask: (code, title, owner) =>
        edit(code, (c) => {
          const id = Math.max(0, ...c.tasks.map((t) => t.id)) + 1
          return { ...c, tasks: [...c.tasks, { id, title, owner, status: "todo", createdBy: c.you, createdAt: Date.now(), updatedAt: Date.now(), notes: [], rounds: [], archived: false }] }
        }),
      setTaskStatus: (code, id, status) => editTask(code, id, (t) => ({ ...t, status, updatedAt: Date.now() })),
      archiveTask: (code, id) => editTask(code, id, (t) => ({ ...t, archived: true })),
      setRole: (code, name, role) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, role: role ?? undefined } : p)) })),
      removeMember: (code, name) => edit(code, (c) => ({ ...c, people: c.people.filter((p) => p.name !== name) })),
      setPersona: (code, name, persona) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, persona: persona ?? undefined } : p)) })),
      setReadOnly: (code, name, on) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, readOnly: on } : p)) })),
      setWake: (code, name, on) => edit(code, (c) => ({ ...c, people: c.people.map((p) => (p.name === name ? { ...p, wakes: on } : p)) })),
      addAgent: (code, a) => {
        window.setTimeout(
          () =>
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
                  typing: false,
                  harness: a.harness,
                  runs: HARNESSES.find((h) => h.id === a.harness)?.label,
                  machine: DEMO_ACCOUNT.computers.find((m) => m.id === a.computer)?.label ?? a.computer,
                  folder: a.folder,
                  persona: PERSONAS.find((p) => p.id === a.persona)?.label ?? a.persona,
                  role: a.role,
                  sponsor: c.you,
                  lastSeen: Date.now(),
                  joined: Date.now(),
                  messages: 0,
                },
              ],
            })),
          2400
        )
      },
      addRoom: (code, name) => edit(code, (c) => ({ ...c, rooms: [...c.rooms, { id: name, name, unread: 0, mentions: 0 }] })),
      renameChannel: (code, title) => {
        edit(code, (c) => ({ ...c, title }))
        setState((s) => ({ ...s, tiles: s.tiles.map((t) => (t.code === code ? { ...t, title } : t)) }))
      },
      setGoal: (code, goal) => edit(code, (c) => ({ ...c, goal: goal || undefined })),
      setHold: (code, on, note) => edit(code, (c) => ({ ...c, hold: on ? { note, by: c.you, at: Date.now() } : undefined })),
      addRepo: (code, repo) => edit(code, (c) => ({ ...c, repos: [...new Set([...c.repos, repo])] })),
      removeRepo: (code, repo) => edit(code, (c) => ({ ...c, repos: c.repos.filter((r) => r !== repo) })),
      joinCommand: async (code, as) => [`kiwi join ${code}-x7Qp2LmR`, as.nick && `--nick ${as.nick}`, as.persona && "--persona eyJyb29tIjoia2l3aSJ9"].filter(Boolean).join(" "),
      inviteLink: async (code) => `kiwi://join/${code}-x7Qp2LmR`,
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
      joinChannel: async (code) => {
        setState((s) => {
          const channels = new Map(s.channels)
          channels.set(code, { ...DEMO_WAITING, code, title: code })
          return { ...s, channels, tiles: [...s.tiles, { code, title: code, state: "waiting", unread: 0, needsYou: 0, last: Date.now() }] }
        })
        return code
      },
      setName: (name) => setState((s) => (s.account ? { ...s, account: { ...s.account, name } } : { ...s, account: { ...DEMO_ACCOUNT, name } })),
      setPrefs: (p) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...p } })),
      pairBegin: async () => "KIWI-7305-PAIR",
      forgetComputer: (id) => setState((s) => (s.account ? { ...s, account: { ...s.account, computers: s.account.computers.filter((c) => c.id !== id) } } : s)),
      linkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: { login: "ojowwalker77" } } } : s)),
      unlinkGithub: () => setState((s) => (s.account ? { ...s, account: { ...s.account, github: undefined } } : s)),
      applyUi: () => setState((s) => (s.account ? { ...s, account: { ...s.account, uiUpdate: undefined } } : s)),
      installUpdate: () => setState((s) => (s.account?.update ? { ...s, account: { ...s.account, version: s.account.update.version, update: undefined } } : s)),
      signOut: () => setState((s) => ({ ...s, account: null, tiles: [] })),
      setNewMembers: (code, can) => edit(code, (c) => ({ ...c, newMembers: can })),
      closeChannel: (code) => setState((s) => ({ ...s, tiles: s.tiles.filter((t) => t.code !== code) })),
      answerPair: () => setState((s) => (s.account ? { ...s, account: { ...s.account, pairAsk: undefined } } : s)),
      cancelPair: () => setState((s) => (s.account ? { ...s, account: { ...s.account, pairAsk: undefined } } : s)),
      saveTheme: (theme) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...savedTheme(s.prefs, theme) } })),
      deleteTheme: (id) => setState((s) => ({ ...s, prefs: { ...s.prefs, ...deletedTheme(s.prefs, id) } })),
    }
  }, [])

  return {
    account: state.account,
    channels: state.tiles,
    channel: open ? (state.channels.get(open) ?? null) : null,
    prefs: state.prefs,
    harnesses: HARNESSES,
    personas: PERSONAS,
    actions,
  }
}
