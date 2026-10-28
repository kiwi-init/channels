import { handBackText, heldBy } from "@kiwi/core/handback.ts"
import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import { handleFor, NAME_RE, nameKey } from "@kiwi/core/membership.ts"
import { permissionReply } from "@kiwi/core/permission.ts"
import { cleanPersonalities } from "@kiwi/core/personalities.ts"
import { personaOf, personaScopes, type Persona, type Personality } from "@kiwi/core/personality.ts"
import { pinned } from "@kiwi/core/pin.ts"
import { PRESETS } from "@kiwi/core/presets.ts"
import { BRANCH_PREFIX_RE, ROBOT_FACES, ROOM_ID_RE, TASK_TITLE_MAX_LENGTH, type Event } from "@kiwi/core/protocol.ts"
import { describeScopes, SCOPES, wireScopes, type Scope } from "@kiwi/core/scopes.ts"
import { newRoomId, taskId } from "@kiwi/core/state.ts"
import type { Permission } from "@kiwi/core/launch-options.ts"
import { tokenForCreate } from "@/lib/auth"
import { askToJoin, createChannel, forgetChannel, forgetPending, inviteInfo, isJoinCode, loadMember, loadPending, renameChannel } from "@/lib/channel"
import { linkOf, type ChannelLink } from "@/lib/channel-ops"
import { removeComputer } from "@/lib/computers"
import { joinCodeFromLink } from "@/lib/deep-link"
import { kiwiJoin } from "@/lib/join-line"
import { relayUrl } from "@/lib/relay"
import { noteFor, showSeat, type ShowResult } from "@/lib/show-seat"
import { cleanRoomName, roomProblem, roomsAfter } from "@/lib/rooms"
import { ALLOW_ONCE, DENY } from "@/lib/permission-settled"
import { savePersonalities } from "@/lib/personalities"
import { createPerson, bridge, secrets } from "@/lib/secrets"
import { isSignInGone } from "@/lib/session"
import { approveTask, closedDigest, sendBackTask, type TaskSend } from "@/lib/task-actions"
import { announce } from "~/kit/toasts"
import {
  answerPair,
  cancelPair,
  enrollAnswer,
  enrollBegin,
  enrollCancel,
  enrollConfirm,
  enrollDeny,
  forgetDevice,
  linkGithub,
  pairBegin,
  renewDevice,
  unlinkGithub,
  type EnrollDone,
} from "~/live/account"
import { newMemberPowers, newMemberScopes, setNewMemberPowers, setNewMemberScopes } from "~/live/defaults"
import { deleteTheme, saveTheme, setPrefs } from "~/live/prefs"
import { harnessChoices, STARTS } from "~/live/harness-rows"
import { iconFromFile } from "~/live/icon-file"
import { seatOf } from "~/live/seats"
import { memberName } from "@/lib/format"
import { checkComputer, computerSettings, setContextLine, setHooks } from "~/live/computer"
import { addStartFolder, allowNewAgents, allowRemoteBypass, preferTerminal, removeStartFolder, setTerminalHelpers } from "~/live/starts"
import { closeOpened, openedChannel, openedRun, type Run } from "~/live/store"
import { stepReplyText } from "~/chat/step"
import { downloadAndRestart } from "~/live/update"
import { setWake } from "~/live/wakes"
import { rememberOwner } from "~/live/invites"
import type { Actions, InviteInfo, JoinChoice, NewAgent, TaskStatus } from "~/model"

const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function attempt(what: string, run: () => Promise<unknown>): void {
  void (async () => run())().catch((err: unknown) => announce(`${what}: ${say(err)}`))
}

function need(code: string): Run {
  const run = openedRun(code)
  if (!run) throw new Error("open the channel first")
  return run
}

function owner(code: string): Run {
  const run = need(code)
  if (!run.isOwner) throw new Error("only the channel's owner can do that")
  return run
}

function link(code: string): ChannelLink {
  const run = openedRun(code)
  if (run) return run.ch
  const m = loadMember(code)
  if (!m) throw new Error("you're not in that channel")
  return linkOf(m)
}

function memberOf(run: Run, name: string): RosterMember {
  const m = run.roster.find((r) => r.active && !r.unverified && r.name === name)
  if (!m) throw new Error(`${name} isn't in this channel`)
  return m
}

const event = (run: Run, body: string, ev: Event, to?: string[]) => run.send(body, { kind: "event", ev, ...(to?.length ? { to } : {}) })

async function sends(run: Run, ...all: TaskSend[]): Promise<void> {
  for (const { body, opts } of all) await run.send(body, opts)
}

function personalities(): Personality[] {
  return [...PRESETS, ...cleanPersonalities(secrets().personalities)]
}

async function roomFolded(run: () => Run | null, room: { id: string; name: string }): Promise<void> {
  for (const end = Date.now() + 10_000; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) if (run()?.state.rooms.get(room.id)?.name === room.name) return
  throw new Error(`#${room.name} was sent but hasn't come back from the relay yet: look again in a moment`)
}

async function personaFor(r: JoinRequest, choice: JoinChoice): Promise<Persona | null> {
  if (r.kind === "human" || choice.persona === null) return null
  const all = personalities()
  if (choice.persona !== undefined) {
    const p = all.find((x) => x.id === choice.persona)
    if (!p) throw new Error("that personality isn't on this computer")
    return personaOf(p)
  }
  if (!r.pin) return null
  const pin = await pinned(r.pin, all)
  if (!pin) throw new Error(`${r.name} was invited as ${r.pin.name}, which isn't on this computer anymore`)
  return pin
}

async function letIn(run: Run, r: JoinRequest, choice: JoinChoice): Promise<string> {
  const name = choice.as?.trim() || r.name
  if (name !== r.name) {
    if (!NAME_RE.test(name)) throw new Error(`${name} can't be a name: letters, digits, . _ - only`)
    if (run.roster.some((m) => m.active && m.pk !== r.pk && nameKey(m.name) === nameKey(name))) throw new Error(`${name} is taken here too`)
  }
  const persona = await personaFor(r, choice)
  const scopes = choice.readOnly === undefined ? newMemberScopes(run.roomId) : choice.readOnly ? [] : [...SCOPES]
  const powers = r.kind === "human" ? (choice.powers ?? newMemberPowers(run.roomId)) : null
  const granted = powers ? { ...(powers.addsAgents ? { addsAgents: true } : {}), ...(powers.answersDecisions ? { answersDecisions: true } : {}) } : {}
  const as = persona ? { persona } : { ...(wireScopes(scopes) ? { scopes } : {}), ...granted }
  try {
    await run.ch.approve(name === r.name ? r : { ...r, name }, as, { person: secrets().person?.pk })
  } catch (err) {
    const joined = (await run.ch.members().catch(() => [])).find((m) => m.active && !m.unverified && m.pk === r.pk)
    if (!joined) throw err
  } finally {
    await Promise.all([run.refreshRequests(), run.refreshRoster()])
  }
  return persona ? `${r.display || name} joined as ${persona.name}` : `${r.display || name} joined`
}

async function scopesFor(run: Run, name: string, scopes: Scope[]): Promise<void> {
  const m = memberOf(run, name)
  const wire = wireScopes(scopes)
  const seq = await event(run, `set what ${m.name} may do: ${wire ? describeScopes(wire) : "full"}`, { op: "scope.set", member: m.name, pk: m.pk, scopes: wire, keepLead: true })
  await run.ch.updateScopes(m, scopes, seq)
  await run.refreshRoster()
}

function launchId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

const PERMISSION: Record<NonNullable<NewAgent["mode"]>, Permission> = { "ask-first": "default", "accept-edits": "accept-edits", "dont-ask": "bypass" }

const STATES: Partial<Record<TaskStatus, "todo" | "doing" | "review" | "done">> = { todo: "todo", doing: "doing", review: "review", done: "done" }

function joinCodeOf(typed: string): string | null {
  const raw = typed.trim()
  if (isJoinCode(raw)) return raw
  const linked = joinCodeFromLink(raw)
  if (linked) return linked
  try {
    const hash = decodeURIComponent(new URL(raw).hash.slice(1)).trim()
    if (isJoinCode(hash)) return hash
    const path = /\/join\/([^/?#]+)/.exec(new URL(raw).pathname)?.[1]
    const fromPath = path ? decodeURIComponent(path) : ""
    return isJoinCode(fromPath) ? fromPath : null
  } catch {
    return null
  }
}

async function newChannel(title: string): Promise<string> {
  const person = secrets().person
  const make = async (fresh: boolean) => createChannel(title.trim() || "Untitled channel", await tokenForCreate(fresh), person ? { name: person.name } : null)
  const m = await make(false).catch((err: unknown) => {
    if (isSignInGone(err) && bridge()) return make(true)
    throw err
  })
  await linkOf(m)
    .setIcon({ kind: "robot", robot: ROBOT_FACES[Math.floor(Math.random() * ROBOT_FACES.length)] ?? "blue" })
    .catch(() => {
      // The channel exists either way; its owner can pick an icon later.
    })
  return m.code
}

async function lookUpInvite(typed: string): Promise<InviteInfo> {
  const code = joinCodeOf(typed)
  if (!code) throw new Error("That isn't an invite. Codes start with mc2-")
  if (loadMember(code) || loadPending(code)) return { code, owner: null, state: "member" }
  const info = await inviteInfo(code)
  if (!info) return { code, owner: null, state: "gone" }
  if (info.ownerName) rememberOwner(code, info.ownerName)
  return { code, owner: info.ownerName, state: "ok" }
}

async function joinChannel(typed: string, name?: string): Promise<string> {
  const code = joinCodeOf(typed)
  if (!code) throw new Error("That isn't an invite. Codes start with mc2-")
  if (loadMember(code) || loadPending(code)) return code
  const person = secrets().person
  if (!person) throw new Error("Say your name first")
  await askToJoin(code, name?.trim() || handleFor(person.name))
  return code
}

async function joinGranted(d: EnrollDone): Promise<void> {
  const name = handleFor(d.person.name)
  let asked = 0
  for (const c of d.channels) {
    if (loadMember(c.code) || loadPending(c.code)) continue
    await askToJoin(c.code, name)
    asked++
  }
  announce(asked ? `Signed in as ${d.person.name}. Asked to join ${asked === 1 ? "1 channel" : `${asked} channels`}` : `Signed in as ${d.person.name}`)
}

export function makeActions(): Actions {
  return {
    send: (code, where, text, opts) =>
      attempt("Not sent", async () => {
        const run = need(code)
        try {
          await run.post(where, text, opts ?? {})
        } catch {
          // The message stays in the feed as "Couldn't send", with Retry.
        }
      }),
    retry: (code, seq) =>
      attempt("Not sent", async () => {
        const run = need(code)
        try {
          await run.retry(-seq)
        } catch {
          // A retry that fails again is marked "Couldn't send" once more.
        }
      }),
    discard: (code, seq) => attempt("Couldn't remove it", async () => need(code).discard(-seq)),
    react: (code, seq, emoji) =>
      attempt("Couldn't react", async () => {
        const run = need(code)
        const mine = run.state.reactions.get(seq)?.get(run.me)?.emoji === emoji
        await event(run, "reaction", { op: "react", seq, emoji: mine ? null : emoji })
      }),
    answerPermission: (code, id, allow) =>
      attempt("Not answered", async () => {
        const run = need(code)
        const m = run.messages.find((x) => x.seq === Number(id))
        if (!m) throw new Error("that request is gone")
        const perm = permissionReply(m, allow, run.state)
        if (!perm) throw new Error("this one can only be answered in the terminal")
        await run.send(allow ? ALLOW_ONCE : DENY, { to: [m.from], re: [m.seq], kind: "msg", perm })
      }),
    answerQuestion: (code, id, text) =>
      attempt("Not answered", async () => {
        const run = need(code)
        const m = run.messages.find((x) => x.seq === Number(id))
        if (!m) throw new Error("that question is gone")
        await run.send(text, { to: [m.from], re: [m.seq], kind: "msg" })
      }),
    answerStep: (code, id, reply) =>
      attempt("Not answered", async () => {
        const run = need(code)
        const m = run.messages.find((x) => x.seq === Number(id))
        if (!m) throw new Error("that step is gone")
        await run.send(stepReplyText(reply), { to: [m.from], re: [m.seq], kind: "msg", stepReply: reply })
      }),
    answerJoin: (code, id, yes, choice) =>
      attempt(yes ? "Couldn't let them in" : "Couldn't turn them away", async () => {
        const run = owner(code)
        const r = run.requests.find((x) => x.id === id)
        if (!r) throw new Error("that request is gone")
        if (!yes) {
          await run.ch.deny(r.id)
          await run.refreshRequests()
          return announce(`Turned ${r.display || r.name} away`)
        }
        if (r.check === "unchecked") {
          await run.ch.checkRequest(r)
          await run.refreshRequests()
          return announce(`Asked ${r.display || r.name} for its code: compare it, then let it in`)
        }
        if (r.check !== "ready" || !r.code) return announce(`Waiting for ${r.display || r.name}'s code`)
        announce(await letIn(run, r, choice ?? {}))
      }),
    approveTask: (code, id, approve, why) =>
      attempt(approve ? "Not approved" : "Not sent back", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        if (approve) await sends(run, approveTask(t), closedDigest(run.state, [...run.messages], t, { by: run.me }))
        else await sends(run, sendBackTask(t, why?.trim() || "sent back for another look"))
      }),
    addTask: (code, title, taskOwner) =>
      attempt("Task not added", async () => {
        const run = need(code)
        const clean = title.trim().slice(0, TASK_TITLE_MAX_LENGTH)
        if (!clean) throw new Error("a task needs a title")
        await event(run, `task: ${clean}`, { op: "task.add", title: clean, ...(taskOwner ? { owner: taskOwner } : {}) }, taskOwner ? [taskOwner] : undefined)
      }),
    setTaskStatus: (code, id, status) =>
      attempt("Status not changed", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        const state = STATES[status]
        if (!state) throw new Error("a task waits on its own, when something holds it")
        const to = t.owner && t.owner !== run.me ? [t.owner] : undefined
        await event(run, `${taskId(id)} ${state}`, { op: "task.update", task: id, state }, to)
      }),
    setRole: (code, name, role) =>
      attempt("Role not changed", async () => {
        const run = owner(code)
        memberOf(run, name)
        await event(run, role ? `made ${name} ${role}` : `cleared ${name}'s role`, { op: "role.set", member: name, role })
      }),
    removeMember: (code, name) =>
      attempt(`Couldn't remove ${name}`, async () => {
        const run = owner(code)
        const m = memberOf(run, name)
        const held = heldBy(run.state, name)
        const lead = run.state.lead && run.state.lead !== name ? [run.state.lead] : undefined
        if (held.length) await run.send(handBackText(run.state, name, "removed", held), lead ? { to: lead } : {})
        await run.ch.remove(m.pk)
        await run.refreshRoster()
        announce(`Removed ${m.display || name}`)
      }),
    setPersona: (code, name, id) =>
      attempt("Personality not changed", async () => {
        const run = owner(code)
        const m = memberOf(run, name)
        const p = id === null ? null : personalities().find((x) => x.id === id)
        if (p === undefined) throw new Error("that personality isn't on this computer")
        const persona = p ? personaOf(p) : null
        const wire = wireScopes(persona ? personaScopes(persona) : [...SCOPES])
        const seq = await event(run, persona ? `made ${m.name} ${persona.name}` : `took ${m.name}'s personality away`, {
          op: "scope.set",
          member: m.name,
          pk: m.pk,
          scopes: wire,
          lead: persona?.role === "lead",
          wasLead: m.persona?.role === "lead",
        })
        await run.ch.updatePersona(m, persona, seq)
        await run.refreshRoster()
      }),
    setReadOnly: (code, name, on) => attempt("Not changed", () => scopesFor(owner(code), name, on ? [] : [...SCOPES])),
    setWake: (code, name, on) => attempt("Not changed", () => setWake(need(code).roomId, name, on)),
    setNickname: (code, name, nickname) =>
      attempt("Nickname not changed", async () => {
        const run = owner(code)
        await run.ch.updateNickname(memberOf(run, name), nickname?.trim() || null)
        await run.refreshRoster()
      }),
    setColor: (code, name, color) =>
      attempt("Colour not changed", async () => {
        const run = need(code)
        if (name !== run.me && !run.isOwner) throw new Error("only that person or the owner sets a colour")
        await event(run, color ? `${name}'s colour is ${color}` : `cleared ${name}'s colour`, { op: "color.set", member: name, color })
      }),
    setPowers: (code, name, powers) =>
      attempt("Not changed", async () => {
        const run = owner(code)
        const m = memberOf(run, name)
        await run.ch.updatePowers(m, { addsAgents: powers.addsAgents ?? !!m.addsAgents, answersDecisions: powers.answersDecisions ?? !!m.answersDecisions })
        await run.refreshRoster()
      }),
    showAgent: async (code, name) => {
      const seat = seatOf(need(code).roomId, name)
      if (!seat) return "It isn't running in a window on this computer."
      const r = await showSeat(seat).catch((): ShowResult => ({ ok: false, why: "failed" }))
      return noteFor(seat.place, r)
    },
    choicesOn: async (code, computer) => {
      const b = bridge()
      if (!b) return { error: "agents start from the Channels desktop app" }
      const here = secrets().computers.find((c) => c.own)?.machinePk
      try {
        if (computer === "this" || computer === here) return { folders: await b.launchRoots() }
        const [h, f] = await Promise.all([b.harnessesOn(computer), b.foldersOn(computer, need(code).roomId)])
        if (!h.ok) return { error: h.detail }
        return { harnesses: harnessChoices(h.value), folders: f.ok ? f.value : [] }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    },
    chooseFolder: async () => {
      const b = bridge()
      return b ? b.chooseFolder() : null
    },
    addAgent: (code, agent) =>
      attempt("Agent not started", async () => {
        const b = bridge()
        if (!b) throw new Error("starting agents needs the Channels desktop app")
        const run = need(code)
        const harness = STARTS[agent.harness]
        if (!harness) throw new Error("pick a harness Channels knows how to start")
        const p = agent.persona ? personalities().find((x) => x.id === agent.persona) : undefined
        const pin = p && run.isOwner ? await run.ch.pinPersona(p) : undefined
        const here = secrets().computers.find((c) => c.own)?.machinePk
        const r = await b.launchAgent({
          ...(agent.computer && agent.computer !== here && agent.computer !== "this" ? { machinePk: agent.computer } : {}),
          launch: launchId(),
          harness,
          folder: agent.folder,
          code,
          relay: relayUrl(),
          ...(agent.name ? { nick: agent.name } : {}),
          ...(pin ? { persona: pin } : {}),
          ...(agent.mode && agent.mode !== "ask-first" ? { permission: PERMISSION[agent.mode] } : {}),
        })
        if (!r.ok) throw new Error(r.detail || "Kiwi couldn't start it")
        announce(`Starting ${agent.name || harness}`)
      }),
    addRoom: (code, typed) =>
      attempt("Room not made", async () => {
        const run = owner(code)
        const problem = roomProblem(run.state.rooms.values(), typed)
        if (problem) throw new Error(problem)
        const name = cleanRoomName(typed)
        const slug = name.toLowerCase()
        const room = { id: ROOM_ID_RE.test(slug) && !run.state.rooms.has(slug) ? slug : newRoomId(), name }
        const since = await event(run, `made the room #${room.name}`, { op: "room.create", ...room })
        await roomFolded(() => openedRun(code), room)
        await run.ch.setRooms({ list: roomsAfter(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values(), room), since })
      }),
    setGithubWrite: (code, on) =>
      attempt("Not changed", async () => {
        await event(owner(code), on ? "turned on Write to GitHub" : "turned off Write to GitHub", { op: "github.write.set", on })
      }),
    setBranchPrefix: (code, typed) =>
      attempt("Branch prefix not changed", async () => {
        const prefix = typed?.trim() || null
        if (prefix && !BRANCH_PREFIX_RE.test(prefix)) throw new Error("a branch prefix is up to 32 letters, digits, dots, dashes, underscores or slashes")
        await event(owner(code), prefix ? `branch prefix: ${prefix}` : "cleared the branch prefix", { op: "branch.prefix.set", prefix })
      }),
    renameRoom: (code, id, typed) =>
      attempt("Room not renamed", async () => {
        const run = owner(code)
        if (!run.state.rooms.has(id)) throw new Error("that room isn't in this channel")
        const problem = roomProblem(run.state.rooms.values(), typed, id)
        if (problem) throw new Error(problem)
        const room = { id, name: cleanRoomName(typed) }
        const since = await event(run, `renamed a room to #${room.name}`, { op: "room.rename", ...room })
        await roomFolded(() => openedRun(code), room)
        await run.ch.setRooms({ list: roomsAfter(openedRun(code)?.state.rooms.values() ?? run.state.rooms.values(), room), since })
      }),
    setIcon: (code, file) =>
      attempt("Icon not changed", async () => {
        const run = owner(code)
        await run.ch.setIcon(file ? await iconFromFile(file) : null)
      }),
    exportHistory: async (code, kind) => {
      try {
        const run = need(code)
        const b = bridge()
        if (b && !("saveFile" in b)) return announce("Saving the history needs the next Channels update")
        const [{ checkedState, exportNote, logExport, logFileName, transcript }, history] = await Promise.all([import("@/lib/log-export"), run.ch.history(0)])
        const log = logExport(history)
        const state = await checkedState(history, run.foldFrom, () => run.ch.snapshot().catch(() => null), run.state)
        const at = new Date()
        const title = openedChannel(code)?.title
        const text = kind === "log" ? log.text : transcript({ title, log, state, nameOf: (from) => memberName(state.members.get(from), from), at })
        const name = logFileName(title, at, kind)
        if (b) {
          const saved = await b.saveFile(name, text)
          announce(`Saved ${saved} to Downloads`)
        } else {
          const url = URL.createObjectURL(new Blob([text], { type: kind === "log" ? "application/jsonl" : "text/markdown" }))
          const a = document.createElement("a")
          a.href = url
          a.download = name
          a.click()
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        }
        const note = exportNote(log)
        if (!note.complete) announce(note.text)
      } catch (err) {
        announce(`Not saved: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    clearFact: (code, key) =>
      attempt("Note not cleared", async () => {
        await event(need(code), `cleared ${key}`, { op: "fact.del", key })
        announce(`Cleared ${key}`)
      }),
    renameChannel: (code, title) =>
      attempt("Not renamed", async () => {
        const name = title.trim().slice(0, 80)
        if (!name) throw new Error("a channel needs a name")
        await link(code).setTitle(name)
        if (loadMember(code)) await renameChannel(code, name)
      }),
    setGoal: (code, goal) =>
      attempt("Goal not set", async () => {
        const run = owner(code)
        const text = goal.trim() || null
        const since = await event(run, text ? `charter: ${text}` : "cleared the charter", { op: "charter.set", text })
        await run.ch.setCharter({ text, since })
      }),
    setHold: (code, on, note) =>
      attempt(on ? "Agents not paused" : "Agents not resumed", async () => {
        const run = owner(code)
        const ev = { op: "hold.set" as const, on, ...(note ? { note } : {}) }
        const since = await event(run, on ? `on hold${note ? `: ${note}` : ""}` : "hold lifted", ev)
        await run.ch.setHold({ on, ...(note ? { note } : {}), since })
      }),
    myRepos: async () => {
      const b = bridge()
      if (!b) return []
      try {
        return (await b.githubRepos()).map((r) => r.fullName)
      } catch {
        // Unlinked GitHub, or no reach to it: the field still takes owner/repo typed by hand.
        return []
      }
    },
    addRepo: (code, repo) => attempt("Repo not added", () => setRepos(owner(code), [...new Set([...owner(code).state.repos, repo.trim()])])),
    removeRepo: (code, repo) =>
      attempt("Repo not removed", () =>
        setRepos(
          owner(code),
          owner(code).state.repos.filter((r) => r !== repo)
        )
      ),
    joinCommand: async (code, as) => {
      if (!loadMember(code)) throw new Error("you're not in that channel")
      const picked = as.persona ? personalities().find((p) => p.id === as.persona) : undefined
      if (as.persona && !picked) throw new Error("that personality isn't on this computer")
      const pin = picked ? await owner(code).ch.pinPersona(picked) : null
      return `kiwi ${kiwiJoin(relayUrl(), code, { ...(as.nick ? { nick: as.nick } : {}), persona: pin })}`
    },
    inviteLink: async (code) => {
      if (!loadMember(code)) throw new Error("you're not in that channel")
      return `${relayUrl()}/#${code}`
    },
    leaveChannel: (code) =>
      attempt("Couldn't leave", async () => {
        if (loadPending(code) && !loadMember(code)) {
          closeOpened(code)
          return forgetPending(code)
        }
        await link(code).leave()
        closeOpened(code)
        await forgetChannel(code)
      }),
    closeChannel: (code) =>
      attempt("Couldn't close it", async () => {
        const run = owner(code)
        await run.ch.close()
        closeOpened(code)
        await forgetChannel(code)
      }),
    newChannel,
    inviteInfo: lookUpInvite,
    joinChannel,
    setName: (name) =>
      attempt("Name not saved", async () => {
        if (secrets().person) throw new Error("your name stays the one your key was made with")
        await createPerson(name.trim())
      }),
    setPrefs,
    pairBegin,
    forgetComputer: (id) =>
      attempt("Couldn't forget it", async () => {
        if (id.startsWith("phone:")) {
          const b = bridge()
          if (!b?.forgetPhone) throw new Error("forgetting a phone here needs the next Channels update; until then, unlink it on the phone")
          await b.forgetPhone(Number(id.slice("phone:".length)))
          return announce("Forgot it. Unlink it on the phone too")
        }
        const removed = await removeComputer(id)
        announce(removed.length ? `Forgot it and removed ${removed.join(", ")}` : "Forgot it")
      }),
    linkGithub: () => attempt("GitHub not linked", linkGithub),
    unlinkGithub: () => attempt("GitHub not unlinked", unlinkGithub),
    windowControl: (action) =>
      void bridge()
        ?.windowControl(action)
        .catch(() => {}),
    checkUpdate: async () => {
      const b = bridge()
      if (!b) return null
      try {
        const u = await b.checkUpdate()
        if (u.state === "current" || u.state === "failed") return u
        return { state: u.state, version: u.version, ...(u.blocked ? { blocked: true } : {}) }
      } catch {
        // A check that throws is shown the same as one that couldn't reach GitHub.
        return { state: "failed" }
      }
    },
    setRelay: async (url) => {
      const b = bridge()
      if (!b) return "only the desktop app can change its relay"
      try {
        await b.setRelayUrl(url.trim())
        return null
      } catch (err) {
        return err instanceof Error ? err.message.replace(/^.*?Error: /, "") : String(err)
      }
    },
    installUpdate: () =>
      attempt("Couldn't update", async () => {
        const b = bridge()
        if (!b) throw new Error("updates come with the Channels desktop app")
        await downloadAndRestart(b, announce)
      }),
    applyUi: () =>
      attempt("Couldn't switch to the new look", async () => {
        const b = bridge()
        if (!b) throw new Error("the new look comes with the Channels desktop app")
        await b.applyUi()
      }),
    signOut: () =>
      attempt("Couldn't sign out", async () => {
        const b = bridge()
        if (!b) throw new Error("only the desktop app keeps a sign-in")
        await b.signOut()
        announce("Signed out of the relay. Your key and channels stay on this computer")
      }),
    setNewMembers: (code, can) =>
      attempt("Not changed", async () => {
        const m = loadMember(code)
        if (!m) throw new Error("you're not in that channel")
        setNewMemberScopes(m.access.roomId, can)
      }),
    setNewPowers: (code, powers) =>
      attempt("Not changed", async () => {
        const m = loadMember(code)
        if (!m) throw new Error("you're not in that channel")
        setNewMemberPowers(m.access.roomId, powers)
      }),
    answerPair: (accept) => attempt("Pairing failed", () => answerPair(accept)),
    cancelPair: () => attempt("Couldn't cancel", cancelPair),
    enrollAnswer: (id) => attempt("Couldn't answer the device", () => enrollAnswer(id)),
    enrollConfirm,
    enrollDeny: (id) => attempt("Couldn't turn the device away", () => enrollDeny(id)),
    forgetDevice: (id) => attempt("Couldn't forget the device", () => forgetDevice(id)),
    renewDevice: (id) => attempt("Couldn't renew the device", () => renewDevice(id)),
    enrollBegin: () =>
      attempt("Couldn't sign in as one of your devices", () =>
        enrollBegin(
          () => tokenForCreate(),
          (d) => attempt("Couldn't join your channels", () => joinGranted(d))
        )
      ),
    enrollCancel: () => attempt("Couldn't take the ask back", enrollCancel),
    saveTheme,
    deleteTheme,
    addStartFolder: () => attempt("Couldn't add the folder", addStartFolder),
    removeStartFolder: (dir) => attempt("Couldn't remove the folder", () => removeStartFolder(dir)),
    allowNewAgents: (on) => attempt("Couldn't change new agents", () => allowNewAgents(on)),
    allowRemoteBypass: (on) => attempt("Couldn't change bypass", () => allowRemoteBypass(on)),
    savePersonalities: (list) => attempt("Not saved", () => savePersonalities(list)),
    setHooks: (harness, on) => attempt("Couldn't change the hooks", () => setHooks(harness, on)),
    checkComputer,
    computerSettings,
    preferTerminal: (id) => attempt("Couldn't change where agents open", () => preferTerminal(id)),
    setTerminalHelpers: (id, on) => attempt(on ? "Couldn't download the helpers" : "Couldn't remove the helpers", () => setTerminalHelpers(id, on)),
    setContextLine: (on) => attempt("Couldn't change it", () => setContextLine(on)),
  }
}

async function setRepos(run: Run, repos: string[]): Promise<void> {
  await run.ch.setGithubRepos(repos)
  const since = await event(run, repos.length ? `repos: ${repos.join(", ")}` : "cleared the channel's repos", { op: "repos.set", repos })
  await run.ch.setRepos({ list: repos, since })
}
