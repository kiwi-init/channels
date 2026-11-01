import { handleFor } from "@kiwi/core/membership.ts"
import { ROBOT_FACES, TASK_TITLE_MAX_LENGTH } from "@kiwi/core/protocol.ts"
import { taskId } from "@kiwi/core/state.ts"
import { assignTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { tokenForCreate } from "@kiwi/app/auth.ts"
import { askToJoin, createChannel, inviteInfo } from "@kiwi/channel/join.ts"
import { forgetChannel, forgetPending, isJoinCode, loadMember, loadPending, renameChannel } from "@kiwi/channel/store.ts"
import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts"
import { joinCodeFromLink } from "@kiwi/app/deep-link.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { noteFor, showSeat, type ShowResult } from "@kiwi/app/show-seat.ts"
import { savePersonalities } from "@kiwi/app/personalities.ts"
import { createPerson, bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { isSignInGone } from "@kiwi/channel/session.ts"
import { announce } from "~/kit/toasts"
import {
  enrollAnswer,
  enrollBegin,
  enrollCancel,
  enrollConfirm,
  enrollDeny,
  enrollKeep,
  forgetDevice,
  linkGithub,
  recoverBegin,
  recoverFinish,
  recoverOpen,
  recoveryDrop,
  recoverySave,
  recoveryWords,
  renewDevice,
  unlinkGithub,
  type EnrollDone,
} from "~/live/account"
import { loadPicture } from "~/live/pictures"
import { setNewMemberPowers, setNewMemberScopes } from "~/live/defaults"
import { deleteTheme, saveTheme, setPrefs } from "~/live/prefs"
import { iconFromFile } from "~/live/icon-file"
import { seatOf } from "~/live/seats"
import { checkComputer, computerSettings, setContextLine, setHooks } from "~/live/computer"
import { addStartFolder, allowNewAgents, allowRemoteBypass, removeStartFolder, setTerminalHelpers } from "~/live/starts"
import { markSeenIn } from "@kiwi/app/threads.ts"
import { lastIn, seenKeyOf } from "~/live/seen-place"
import { closeOpened, leavingOnPurpose, openedRun, type Run } from "~/live/store"
import { attempt, event, memberOf, need, owner, say } from "~/live/run"

const manage = () => import("~/live/manage")
const rare = () => import("~/live/rare")
import { downloadAndRestart } from "~/live/update"
import { setWake } from "~/live/wakes"
import { rememberOwner } from "~/live/invites"
import type { Actions, InviteInfo } from "~/model"

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
    loadImage: (code, spot) => loadPicture(code, spot),
    discard: (code, seq) => attempt("Couldn't remove it", async () => need(code).discard(-seq)),
    markRead: (code, where) => {
      const run = need(code)
      const last = lastIn(run.messages, run.state, run.me, where)
      if (last) markSeenIn(run.roomId, { [seenKeyOf(run.state, where, run.me)]: last })
    },
    react: (code, seq, emoji) =>
      attempt("Couldn't react", async () => {
        const run = need(code)
        const mine = run.state.reactions.get(seq)?.get(run.me)?.emoji === emoji
        await event(run, "reaction", { op: "react", seq, emoji: mine ? null : emoji })
      }),
    editMessage: (code, seq, text) => attempt("Not edited", async () => (await rare()).change(code, seq, text)),
    deleteMessage: (code, seq) => attempt("Not deleted", async () => (await rare()).change(code, seq, null)),
    answerPermission: (code, id, allow) => attempt("Not answered", async () => (await rare()).answerPermission(code, id, allow)),
    answerQuestion: (code, id, text) =>
      attempt("Not answered", async () => {
        const run = need(code)
        const m = run.messages.find((x) => x.seq === Number(id))
        if (!m) throw new Error("that question is gone")
        await run.send(text, { to: [m.from], re: [m.seq], kind: "msg" })
      }),
    answerStep: (code, id, reply) => attempt("Not answered", async () => (await rare()).answerStep(code, id, reply)),
    answerJoin: (code, id, yes, choice) => attempt(yes ? "Couldn't let them in" : "Couldn't turn them away", async () => (await manage()).answerJoin(code, id, yes, choice)),
    approveTask: (code, id, approve, why) => attempt(approve ? "Not approved" : "Not sent back", async () => (await rare()).approveTask(code, id, approve, why)),
    addTask: (code, title, taskOwner) =>
      attempt("Task not added", async () => {
        const run = need(code)
        const clean = title.trim().slice(0, TASK_TITLE_MAX_LENGTH)
        if (!clean) throw new Error("a task needs a title")
        await event(run, `task: ${clean}`, { op: "task.add", title: clean, ...(taskOwner ? { owner: taskOwner } : {}) }, taskOwner ? [taskOwner] : undefined)
      }),
    setTaskStatus: (code, id, status) => attempt("Status not changed", async () => (await rare()).setTaskStatus(code, id, status)),
    cancelTask: (code, id, why) => attempt("Not cancelled", async () => (await rare()).cancelTask(code, id, why)),
    assignTask: (code, id, to, why) =>
      attempt("Not assigned", async () => {
        const run = need(code)
        const t = run.state.tasks.get(id)
        if (!t) throw new Error(`no task ${taskId(id)}`)
        memberOf(run, to)
        await sends(run, assignTask(t, to, why.trim() || (t.owner ? `was ${t.owner}'s` : "nobody had it")))
      }),
    setReviewer: (code, id, reviewer) => attempt("Reviewer not changed", async () => (await rare()).setReviewer(code, id, reviewer)),
    nameGoal: (code, ask, name) => attempt("Goal not named", async () => (await rare()).nameGoal(code, ask, name)),
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
    openTerm: async (code, name, cols, rows, watch) => (await rare()).openTerm(code, name, cols, rows, watch),
    openMyTerm: async (code, want, cols, rows, watch) => (await rare()).openMyTerm(code, want, cols, rows, watch),
    myTerms: async () => {
      const b = bridge()
      return b && typeof b.termTabs === "function" ? b.termTabs().catch(() => []) : []
    },
    closeMyTerm: async (pane) => {
      const b = bridge()
      return b && typeof b.termTabClose === "function" ? b.termTabClose(pane).catch(() => []) : []
    },
    choicesOn: async (code, computer) => (await manage()).choicesOn(code, computer),
    chooseFolder: async () => {
      const b = bridge()
      return b ? b.chooseFolder() : null
    },
    addAgent: (code, agent, seen) => {
      let stop = () => {}
      let stopped = false
      void manage().then((m) => {
        if (!stopped) stop = m.addAgent(code, agent, seen)
      })
      return () => {
        stopped = true
        stop()
      }
    },
    addRoom: (code, typed, members) => tried("Room not made", async () => (await manage()).addRoom(code, typed, members)),
    setRoomMembers: (code, id, members) => attempt("Who's in didn't change", async () => (await manage()).setRoomMembers(code, id, members)),
    setGithubWrite: (code, on) => attempt("Not changed", async () => (await manage()).setGithubWrite(code, on)),
    setBranchPrefix: (code, typed) => attempt("Branch prefix not changed", async () => (await manage()).setBranchPrefix(code, typed)),
    renameRoom: (code, id, typed) => attempt("Room not renamed", async () => (await manage()).renameRoom(code, id, typed)),
    setIcon: (code, file) =>
      attempt("Icon not changed", async () => {
        const run = owner(code)
        await run.ch.setIcon(file ? await iconFromFile(file) : null)
      }),
    exportHistory: async (code, kind) => (await manage()).exportHistory(code, kind),
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
    askCompact: (code) => attempt("Not asked", async () => (await rare()).askCompact(code)),
    approveCompact: (code, proposal) => attempt("Not compacted", async () => (await rare()).approveCompact(code, proposal)),
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
    joinCommand: async (code, as) => (await manage()).joinCommand(code, as),
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
    setMute: (code, room, on) => void rare().then((r) => r.setMute(code, room, on)),
    snooze: (until) => void rare().then((r) => r.snooze(until)),
    forgetComputer: (id) => void manage().then((m) => m.forgetComputer(id)),
    linkGithub: () => attempt("GitHub not linked", linkGithub),
    signInWithGithub: () => attempt("Not signed in with GitHub", linkGithub),
    unlinkGithub: () => attempt("GitHub not unlinked", unlinkGithub),
    windowControl: (action) =>
      void bridge()
        ?.windowControl(action)
        .catch(() => {}),
    checkUpdate: async () => (await rare()).checkUpdate(),
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
    recoveryWords: () => tried("Couldn't make the recovery words", recoveryWords),
    recoverySave: (typed) => tried("Couldn't set up the recovery key", () => recoverySave(typed)),
    recoveryDrop: () => attempt("Couldn't put the words away", recoveryDrop),
    enrollBegin: () =>
      attempt("Couldn't sign in as one of your devices", () =>
        enrollBegin(
          () => tokenForCreate(),
          (d) => attempt("Couldn't join your channels", () => joinGranted(d))
        )
      ),
    enrollKeep: () => attempt("Couldn't join as one of your devices", enrollKeep),
    enrollCancel: () => attempt("Couldn't take the ask back", enrollCancel),
    recoverBegin: () => attempt("Couldn't start the recovery", recoverBegin),
    recoverOpen: (words) => tried("Couldn't open your recovery vault", () => recoverOpen(words)),
    recoverFinish: async (lost) => void (await tried("Couldn't finish the recovery", () => recoverFinish(lost))),
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
