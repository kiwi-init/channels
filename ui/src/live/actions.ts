import { TASK_TITLE_MAX_LENGTH } from "@kiwi/core/protocol.ts"
import { taskId, taskSpecRefusal } from "@kiwi/core/state.ts"
import { assignTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { tokenForCreate } from "@kiwi/app/auth.ts"
import { forgetChannel, forgetPending, loadMember, loadPending, renameChannel } from "@kiwi/channel/store.ts"
import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { savePersonalities } from "@kiwi/app/personalities.ts"
import { createPerson, bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { announce } from "~/kit/toasts"
import { loadPicture } from "~/live/pictures"
import { appCan } from "~/live/app-can"
import { setNewMemberPowers, setNewMemberScopes } from "~/live/defaults"
import { deleteTheme, saveTheme, setPrefs } from "~/live/prefs"
import { checkComputer, computerSettings, setContextLine, setHooks } from "~/live/computer"
import { myUsage } from "~/live/usage"
import { markSeenIn, seenIn } from "@kiwi/app/threads.ts"
import { followKey, followMark } from "~/live/threads"
import { lastIn, seenKeyOf } from "~/live/seen-place"
import { closeOpened, leavingOnPurpose, openedRun, type Run } from "~/live/store"
import { attempt, event, memberOf, need, owner, say } from "~/live/run"
import { refusal } from "~/live/refused"

const manage = () => import("~/live/manage")
const UPDATE_FOR_MEDIA = "Update Channels to add images and files to a doc"
const rare = () => import("~/live/rare")
const account = () => import("~/live/account-rare")
const joining = () => import("~/live/join-rare")
import { setWake } from "~/live/wakes"
import { findDoc } from "~/chat/doc/find-doc"
import type { Actions } from "~/model"

async function tried<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    // The person sees why in the announcement; the caller gets null and stays where it was.
    announce(`${what}: ${say(err)}`, "error")
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

export function makeActions(): Actions {
  return {
    send: async (code, where, text, opts) => {
      const run = openedRun(code)
      if (!run) {
        announce("Not sent: open the channel first", "error")
        return false
      }
      try {
        await run.post(where, text, opts ?? {})
      } catch (err) {
        // A refusal is announced and handed back to where it was written; any other failure stays in the feed as "Couldn't send", with Retry.
        return refusal(err) === null
      }
      return true
    },
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
    leaveRoom: (code, room) =>
      attempt("Couldn't leave the room", async () => {
        await (await manage()).leaveRoom(code, room)
        announce("You've left. It's fully closed once someone else in the room is online.")
      }),
    markRead: (code, where) => {
      const run = need(code)
      const last = lastIn(run.messages, run.state, run.me, where)
      if (last) markSeenIn(run.roomId, { [seenKeyOf(run.state, where, run.me)]: last })
    },
    openDoc: (code, thread, th, on) => link(code).doc(thread, th, on),
    findDoc: (code, thread) => findDoc(link(code), code, thread),
    docVersions: async (code, th) => (await rare()).versionsOf(link(code), th),
    restoreDocVersion: async (code, ...a) => (await rare()).restoreOf(link(code), ...a),
    putDocImage: async (code, upload) => {
      if (!(await appCan("putImage"))) throw new Error(UPDATE_FOR_MEDIA)
      const stored = await link(code).putImage(upload)
      if (!stored.ref) throw new Error(`${upload.name} wasn't stored`)
      return { name: stored.name, mime: stored.mime, ref: stored.ref }
    },
    putDocFile: async (code, upload) => {
      if (!(await appCan("putFileData"))) throw new Error(UPDATE_FOR_MEDIA)
      return link(code).putFileData(upload.name, upload.mime, upload.data)
    },
    docImage: (code, img) => link(code).image(img),
    docFile: async (code, f) => ((await appCan("fileData")) ? link(code).fileData(f) : null),
    followThread: (code, root, on) => {
      const run = need(code)
      markSeenIn(run.roomId, { [followKey(root)]: followMark(seenIn(run.roomId)[followKey(root)], run.messages.at(-1)?.seq ?? 0, on) })
      announce(on ? "Following this thread" : "Not following this thread")
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
        await run.send(text, { to: [m.from], re: [m.seq], kind: "msg", side: true })
      }),
    answerStep: (code, id, reply) => attempt("Not answered", async () => (await rare()).answerStep(code, id, reply)),
    answerJoin: (code, id, yes, choice) => attempt(yes ? "Couldn't let them in" : "Couldn't turn them away", async () => (await manage()).answerJoin(code, id, yes, choice)),
    approveTask: (code, id, approve, why) => attempt(approve ? "Not approved" : "Not sent back", async () => (await rare()).approveTask(code, id, approve, why)),
    addTask: (code, ask, title) =>
      attempt("Task not added", async () => {
        const run = need(code)
        const clean = title.trim().slice(0, TASK_TITLE_MAX_LENGTH)
        if (!clean) throw new Error("a task needs a title")
        const why = taskSpecRefusal(run.state, { re: ask })
        if (why) throw new Error(why)
        await run.send(`task: ${clean}`, { kind: "event", ev: { op: "task.add", title: clean }, re: [ask] })
      }),
    setSpecsOnly: (code, on) => attempt("Not changed", async () => (await manage()).setSpecsOnly(code, on)),
    setTaskStatus: (code, id, status) => attempt("Status not changed", async () => (await rare()).setTaskStatus(code, id, status)),
    cancelTask: (code, id, why) => attempt("Not cancelled", async () => (await rare()).cancelTask(code, id, why)),
    closeTask: (code, id, why) => attempt("Not closed", async () => (await rare()).closeTask(code, id, why)),
    editTask: (code, id, change) => attempt("Not saved", async () => (await rare()).editTask(code, id, change)),
    deleteTask: (code, id) => attempt("Not deleted", async () => (await rare()).deleteTask(code, id)),
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
    newSpec: async (code, words, text) => {
      try {
        return await (await rare()).newSpec(code, words, text)
      } catch (err) {
        announce(`Spec not started: ${say(err)}`)
        return null
      }
    },
    writeSpec: (code, ask, text) => attempt("Spec not saved", async () => (await rare()).writeSpec(code, ask, text)),
    approveSpec: (code, ask, v) => attempt("Not approved", async () => (await rare()).approveSpec(code, ask, v)),
    judgeSpec: (code, ask, verdict, note) =>
      attempt(verdict === "accepted" ? "Not accepted" : verdict === "back" ? "Not sent back" : "Not dropped", async () => (await rare()).judgeSpec(code, ask, verdict, note)),
    deleteSpec: (code, ask) => attempt("Not deleted", async () => (await rare()).deleteSpec(code, ask)),
    setRole: (code, name, role) => attempt("Role not changed", async () => (await manage()).setRole(code, name, role)),
    removeMember: (code, name) => attempt(`Couldn't remove ${name}`, async () => (await manage()).removeMember(code, name)),
    setPersona: (code, name, id) => attempt("Personality not changed", async () => (await manage()).setPersona(code, name, id)),
    setReadOnly: (code, name, on) => attempt("Not changed", async () => (await manage()).setReadOnly(code, name, on)),
    setWake: (code, name, on) => attempt("Not changed", () => setWake(need(code).roomId, name, on)),
    setAgentColor: (code, name, color) => attempt("Colour not changed", async () => (await manage()).setAgentColor(code, name, color)),
    setNickname: (code, name, nickname) => attempt("Nickname not changed", async () => (await manage()).setNickname(code, name, nickname)),
    setPowers: (code, name, powers) => attempt("Not changed", async () => (await manage()).setPowers(code, name, powers)),
    addRoom: (code, typed, members) => tried("Room not made", async () => (await manage()).addRoom(code, typed, members)),
    setRoomMembers: async (code, id, members) =>
      (await tried("Who's in didn't change", async () => {
        await (await manage()).setRoomMembers(code, id, members)
        return true
      })) ?? false,
    setGithubWrite: (code, on) => attempt("Not changed", async () => (await manage()).setGithubWrite(code, on)),
    setBranchPrefix: (code, typed) => attempt("Branch prefix not changed", async () => (await manage()).setBranchPrefix(code, typed)),
    setLanding: (code, then) => attempt("How tasks land not changed", async () => (await manage()).setLanding(code, then)),
    setPeopleMerge: (code, on) => attempt("Who merges not changed", async () => (await manage()).setPeopleMerge(code, on)),
    renameRoom: (code, id, typed) => attempt("Room not renamed", async () => (await manage()).renameRoom(code, id, typed)),
    setIcon: (code, file) =>
      attempt("Icon not changed", async () => {
        const run = owner(code)
        await run.ch.setIcon(file ? await (await import("~/live/icon-file")).iconFromFile(file) : null)
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
    myUsage,
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
      attempt("Couldn't delete it", async () => {
        const run = owner(code)
        leavingOnPurpose(code)
        await run.ch.close()
        closeOpened(code)
        await forgetChannel(code)
      }),
    newChannel: async (title) => (await joining()).newChannel(title),
    inviteInfo: async (typed) => (await joining()).lookUpInvite(typed),
    joinChannel: async (typed, name) => (await joining()).joinChannel(typed, name),
    setName: (name) =>
      attempt("Name not saved", async () => {
        if (secrets().person) throw new Error("your name stays the one your key was made with")
        await createPerson(name.trim())
      }),
    setPrefs,
    setMute: (code, room, on) => void rare().then((r) => r.setMute(code, room, on)),
    searchOlder: (code, query, before) => import("~/live/older").then((o) => o.searchOlder(code, query, before)),
    olderAround: (code, seq) => import("~/live/older").then((o) => o.olderAround(code, seq)),
    fetchOlder: (code, got) => import("~/live/older").then((o) => o.fetchOlder(code, got)),
    earlier: (code) => (openedRun(code)?.older.more() ?? Promise.resolve(false)).catch(() => false),
    earlierTo: (code, seq) => (openedRun(code)?.older.to(seq) ?? Promise.resolve(false)).catch(() => false),
    holdEarlier: (code, key, seq) => openedRun(code)?.older.keep(key, seq),
    forgetComputer: (id) => void manage().then((m) => m.forgetComputer(id)),
    linkGithub: () => attempt("GitHub not linked", async () => (await account()).linkGithub()),
    signInWithGithub: () => attempt("Not signed in with GitHub", async () => (await account()).linkGithub()),
    unlinkGithub: () => attempt("GitHub not unlinked", async () => (await account()).unlinkGithub()),
    windowControl: (action) =>
      void bridge()
        ?.windowControl(action)
        .catch(() => {}),
    checkUpdate: async () => (await rare()).checkUpdate(),
    setRelay: async (url) => (await account()).setRelay(url),
    installUpdate: () => attempt("Couldn't update", async () => (await account()).installUpdate()),
    applyUi: () => attempt("Couldn't switch to the new look", async () => (await account()).applyUi()),
    dismissMoved: () => attempt("Couldn't put the note away", async () => (await account()).dismissMoved()),
    signOut: () => attempt("Couldn't sign out", async () => (await account()).signOut()),
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
    enrollAnswer: (id) => attempt("Couldn't answer the device", async () => (await account()).enrollAnswer(id)),
    enrollConfirm: async (id, digits) => (await account()).enrollConfirm(id, digits),
    enrollDeny: (id) => attempt("Couldn't turn the device away", async () => (await account()).enrollDeny(id)),
    forgetDevice: (ids, keep) => attempt("Couldn't forget the device", async () => (await account()).forgetDevice(ids, keep)),
    renewDevice: (...ids) => attempt("Couldn't renew the device", async () => (await account()).renewDevice(...ids)),
    enrollBegin: () =>
      attempt("Couldn't sign in as one of your devices", async () =>
        (await account()).enrollBegin(
          () => tokenForCreate(),
          (d) => attempt("Couldn't join your channels", async () => (await joining()).joinGranted(d))
        )
      ),
    enrollKeep: () => attempt("Couldn't join as one of your devices", async () => (await account()).enrollKeep()),
    enrollCancel: () => attempt("Couldn't take the ask back", async () => (await account()).enrollCancel()),
    saveTheme,
    deleteTheme,
    savePersonalities: (list) => attempt("Not saved", () => savePersonalities(list)),
    setHooks: (harness, on) => attempt("Couldn't change the hooks", () => setHooks(harness, on)),
    checkComputer,
    computerSettings,
    launchedFrom: async (ids) => (await account()).launchedFrom(ids),
    setContextLine: (on) => attempt("Couldn't change it", () => setContextLine(on)),
  }
}
