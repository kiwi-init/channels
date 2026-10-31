import { handleFor } from "@kiwi/core/membership.ts"
import { permissionReply } from "@kiwi/core/permission.ts"
import { MAX_GOAL_NAME, ROBOT_FACES, TASK_TITLE_MAX_LENGTH } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import type { Permission } from "@kiwi/core/launch-options.ts"
import { tokenForCreate } from "@kiwi/app/auth.ts"
import { askToJoin, createChannel, inviteInfo } from "@kiwi/channel/join.ts"
import { forgetChannel, forgetPending, isJoinCode, loadMember, loadPending, renameChannel } from "@kiwi/channel/store.ts"
import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts"
import { removeComputer } from "@kiwi/app/computers.ts"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { inviteLine } from "@kiwi/app/join-line.ts"
import { followLaunch } from "@kiwi/app/launch-follow.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { noteFor, showSeat, type ShowResult } from "@kiwi/app/show-seat.ts"
import { ALLOW_ONCE, DENY } from "@kiwi/app/permission-settled.ts"
import { savePersonalities } from "@kiwi/app/personalities.ts"
import { createPerson, bridge, secrets, type KiwiBridge, type TermEvent, type TermOpenView } from "@kiwi/secrets/secrets.ts"
import { isSignInGone } from "@kiwi/channel/session.ts"
import { ANYONE, approveTask, assignTask, cancelTask, changeReviewer, closedDigest, sendBackTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { announce } from "~/kit/toasts"
import { enrollAnswer, enrollBegin, enrollCancel, enrollConfirm, enrollDeny, enrollKeep, forgetDevice, linkGithub, renewDevice, unlinkGithub, type EnrollDone } from "~/live/account"
import { loadPicture } from "~/live/pictures"
import { setNewMemberPowers, setNewMemberScopes } from "~/live/defaults"
import { deleteTheme, saveTheme, setPrefs } from "~/live/prefs"
import { harnessChoices, STARTS } from "~/live/harness-rows"
import { iconFromFile } from "~/live/icon-file"
import { seatOf } from "~/live/seats"
import { memberName } from "@kiwi/app/format.ts"
import { checkComputer, computerSettings, setContextLine, setHooks } from "~/live/computer"
import { addStartFolder, allowNewAgents, allowRemoteBypass, removeStartFolder, setTerminalHelpers } from "~/live/starts"
import { closeOpened, leavingOnPurpose, openedChannel, openedRun, type Run } from "~/live/store"
import { event, memberOf, need, owner, personalities } from "~/live/run"

const manage = () => import("~/live/manage")
import { stepReplyText } from "~/chat/step"
import { downloadAndRestart } from "~/live/update"
import { setWake } from "~/live/wakes"
import { rememberOwner } from "~/live/invites"
import type { Actions, InviteInfo, NewAgent, TaskStatus, TermOpened, TermWatch } from "~/model"

const COMPACT_ASK =
  "Please draft a /compact summary of the history so far: name every open task (T7) and open question (#123) by its id, then run `kiwi compact --file summary.md`. I'll approve it in the app."

const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function attempt(what: string, run: () => Promise<unknown>): void {
  void (async () => run())().catch((err: unknown) => announce(`${what}: ${say(err)}`))
}

async function tried<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    // The person sees why in the announcement; the caller gets null and stays where it was.
    announce(`${what}: ${say(err)}`)
    return null
  }
}

function link(code: string): ChannelLink {
  const run = openedRun(code)
  if (run) return run.ch
  const m = loadMember(code)
  if (!m) throw new Error("you're not in that channel")
  return linkOf(m)
}

async function sends(run: Run, ...all: TaskSend[]): Promise<void> {
  for (const { body, opts } of all) await run.send(body, opts)
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

async function streamTerm(b: KiwiBridge, open: () => Promise<TermOpenView>, watch: TermWatch): Promise<TermOpened> {
  const early: TermEvent[] = []
  let mine: string | null = null
  const deliver = (e: TermEvent) => ("out" in e ? watch.out(e.out) : watch.ended())
  const off = b.onTerm((e) => (mine === null ? early.push(e) : e.term === mine && deliver(e)))
  const r = await open().catch((err: unknown): TermOpenView => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }))
  if (!r.ok) {
    off()
    return { error: r.detail }
  }
  const term = r.term
  mine = term
  queueMicrotask(() => early.filter((e) => e.term === term).forEach(deliver))
  return {
    screen: { cols: r.cols, rows: r.rows, seed: r.seed, dead: r.dead, pane: r.pane },
    link: {
      keys: (text) => void b.termKeys(term, text).catch(() => {}),
      size: (c, w) => void b.termSize(term, c, w).catch(() => {}),
      close: () => {
        off()
        void b.termClose(term).catch(() => {})
      },
    },
  }
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
    loadImage: (code, spot) => loadPicture(code, spot),
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
    answerJoin: (code, id, yes, choice) => attempt(yes ? "Couldn't let them in" : "Couldn't turn them away", async () => (await manage()).answerJoin(code, id, yes, choice)),
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
    cancelTask: (code, id, why) =>
      attempt("Not cancelled", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        const note = why.trim()
        if (!note) throw new Error("say why it's cancelled")
        await sends(run, cancelTask(t, note, run.me), closedDigest(run.state, [...run.messages], t, { by: run.me, cancelled: note }))
      }),
    assignTask: (code, id, to, why) =>
      attempt("Not assigned", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        memberOf(run, to)
        await sends(run, assignTask(t, to, why.trim() || (t.owner ? `was ${t.owner}'s` : "nobody had it")))
      }),
    setReviewer: (code, id, reviewer) =>
      attempt("Reviewer not changed", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        if (reviewer !== ANYONE) memberOf(run, reviewer)
        await sends(run, changeReviewer(t, reviewer, run.me))
      }),
    nameGoal: (code, ask, name) =>
      attempt("Goal not named", async () => {
        const run = need(code)
        const clean = name?.trim().slice(0, MAX_GOAL_NAME) || null
        await event(run, clean ? `named the goal of #${ask}: ${clean}` : `#${ask}'s goal unnamed`, { op: "ask.name", ask, name: clean })
      }),
    setRole: (code, name, role) => attempt("Role not changed", async () => (await manage()).setRole(code, name, role)),
    removeMember: (code, name) => attempt(`Couldn't remove ${name}`, async () => (await manage()).removeMember(code, name)),
    setPersona: (code, name, id) => attempt("Personality not changed", async () => (await manage()).setPersona(code, name, id)),
    setReadOnly: (code, name, on) => attempt("Not changed", async () => (await manage()).setReadOnly(code, name, on)),
    setWake: (code, name, on) => attempt("Not changed", () => setWake(need(code).roomId, name, on)),
    setNickname: (code, name, nickname) => attempt("Nickname not changed", async () => (await manage()).setNickname(code, name, nickname)),
    setPowers: (code, name, powers) => attempt("Not changed", async () => (await manage()).setPowers(code, name, powers)),
    showAgent: async (code, name) => {
      const seat = seatOf(need(code).roomId, name)
      if (!seat) return "It isn't running in a window on this computer."
      const r = await showSeat(seat).catch((): ShowResult => ({ ok: false, why: "failed" }))
      return noteFor(seat.place, r)
    },
    openTerm: async (code, name, cols, rows, watch) => {
      const b = bridge()
      const seat = seatOf(need(code).roomId, name)
      if (!b) return { error: "Terminals open in the Channels desktop app." }
      if (typeof b.termOpen !== "function") return { error: "Update Channels to open its terminals here." }
      if (seat?.place !== "hosted") return { error: "It isn't running in Channels' own terminal on this computer." }
      return streamTerm(b, () => b.termOpen(seat.pane, cols, rows), watch)
    },
    openMyTerm: async (code, want, cols, rows, watch) => {
      const b = bridge()
      if (!b) return { error: "Your terminal opens in the Channels desktop app." }
      if (typeof b.termMine !== "function") return { error: "Update Channels to open your own terminal here." }
      const room = need(code).roomId
      return streamTerm(b, () => b.termMine(room, want, cols, rows), watch)
    },
    myTerms: async () => {
      const b = bridge()
      return b && typeof b.termTabs === "function" ? b.termTabs().catch(() => []) : []
    },
    closeMyTerm: async (pane) => {
      const b = bridge()
      return b && typeof b.termTabClose === "function" ? b.termTabClose(pane).catch(() => []) : []
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
    addAgent: (code, agent, seen) => {
      const launch = launchId()
      const stop = followLaunch(code, launch, (s) => seen({ stage: s.stage, name: s.name }))
      void (async () => {
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
          launch,
          harness,
          folder: agent.folder,
          code,
          relay: relayUrl(),
          ...(agent.name ? { nick: agent.name } : {}),
          ...(pin ? { persona: pin } : {}),
          ...(agent.mode && agent.mode !== "ask-first" ? { permission: PERMISSION[agent.mode] } : {}),
        })
        if (!r.ok) throw new Error(r.detail || "Kiwi couldn't start it")
        seen({ stage: "started" })
      })().catch((err: unknown) => {
        stop()
        const why = say(err)
        announce(`${agent.name || "Agent"} not started: ${why.split("\n")[0]}`)
        seen({ stage: "failed", why })
      })
      return stop
    },
    addRoom: (code, typed) => tried("Room not made", async () => (await manage()).addRoom(code, typed)),
    setGithubWrite: (code, on) => attempt("Not changed", async () => (await manage()).setGithubWrite(code, on)),
    setBranchPrefix: (code, typed) => attempt("Branch prefix not changed", async () => (await manage()).setBranchPrefix(code, typed)),
    renameRoom: (code, id, typed) => attempt("Room not renamed", async () => (await manage()).renameRoom(code, id, typed)),
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
        const [{ checkedState, exportNote, logExport, logFileName, transcript }, history] = await Promise.all([import("@kiwi/app/log-export.ts"), run.ch.history(0)])
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
    setGoal: (code, goal) => attempt("Goal not set", async () => (await manage()).setGoal(code, goal)),
    setHold: (code, on, note) => attempt(on ? "Agents not paused" : "Agents not resumed", async () => (await manage()).setHold(code, on, note)),
    askCompact: (code) =>
      attempt("Not asked", async () => {
        const run = need(code)
        const lead = run.state.lead && run.state.lead !== run.me ? run.state.lead : null
        await run.send(COMPACT_ASK, lead ? { to: [lead], kind: "ask" } : { kind: "ask" })
        announce(lead ? `Asked ${memberName(run.state.members.get(lead), lead)} for a summary` : "Asked the agents for a summary")
      }),
    approveCompact: (code, proposal) =>
      attempt("Not compacted", async () => {
        const run = owner(code)
        const p = run.state.compactProposal
        if (p?.seq !== proposal) throw new Error("that proposal was replaced or already approved")
        await event(run, `compacted the history through #${p.through}`, { op: "compact", summary: p.summary, through: p.through, proposal: p.seq })
        announce(`History through #${p.through} compacted`)
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
    addRepo: (code, repo) => attempt("Repo not added", async () => (await manage()).addRepo(code, repo)),
    removeRepo: (code, repo) => attempt("Repo not removed", async () => (await manage()).removeRepo(code, repo)),
    joinCommand: async (code, as) => {
      if (!loadMember(code)) throw new Error("you're not in that channel")
      const picked = as.persona ? personalities().find((p) => p.id === as.persona) : undefined
      if (as.persona && !picked) throw new Error("that personality isn't on this computer")
      const pin = picked ? await owner(code).ch.pinPersona(picked) : null
      return inviteLine(relayUrl(), code, { ...(as.nick ? { nick: as.nick } : {}), persona: pin })
    },
    inviteLink: async (code) => {
      if (!loadMember(code)) throw new Error("you're not in that channel")
      return `${relayUrl()}/#${code}`
    },
    leaveChannel: (code) =>
      attempt("Couldn't leave", async () => {
        leavingOnPurpose(code)
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
        leavingOnPurpose(code)
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
    signInWithGithub: () => attempt("Not signed in with GitHub", linkGithub),
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
    enrollKeep: () => attempt("Couldn't join as one of your devices", enrollKeep),
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
    setTerminalHelpers: (id, on) => attempt(on ? "Couldn't download the helpers" : "Couldn't remove the helpers", () => setTerminalHelpers(id, on)),
    setContextLine: (on) => attempt("Couldn't change it", () => setContextLine(on)),
  }
}
