import "~/i18n/en/live-later"
import { TASK_TITLE_MAX_LENGTH } from "@kiwi/core/protocol.ts"
import { taskId, taskSpecRefusal } from "@kiwi/core/state.ts"
import { assignTask, type TaskSend } from "@kiwi/channel/task-actions.ts"
import { forgetChannel, forgetPending, loadMember, loadPending, renameChannel } from "@kiwi/channel/store.ts"
import { relayUrl } from "@kiwi/secrets/relay.ts"
import { savePersonalities } from "@kiwi/app/personalities.ts"
import { createPerson, bridge, secrets } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { appCan } from "~/live/app-can"
import { setNewMemberPowers, setNewMemberScopes } from "~/live/defaults"
import { checkComputer, computerSettings, setContextLine, setHooks } from "~/live/computer-later"
import { closeOpened, leavingOnPurpose, type Run } from "~/live/store"
import { attempt, event, memberOf, need, owner, say } from "~/live/run"
import { setWake } from "~/live/wakes"
import { link } from "~/live/link"
import type { Actions } from "~/model"

const manage = () => import("~/live/manage")
const rare = () => import("~/live/rare")
const account = () => import("~/live/account-rare")
const joining = () => import("~/live/join-rare")
const auth = () => import("@kiwi/app/auth.ts")

async function tried<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run()
  } catch (err) {
    // The person sees why in the announcement; the caller gets null and stays where it was.
    announce(t("live.run.failed", { what, why: say(err) }), "error")
    return null
  }
}

async function sends(run: Run, ...all: TaskSend[]): Promise<void> {
  for (const { body, opts } of all) await run.send(body, opts)
}

export type LaterName = Exclude<
  keyof Actions,
  | "send"
  | "retry"
  | "loadImage"
  | "discard"
  | "markRead"
  | "markChannelRead"
  | "followThread"
  | "openDoc"
  | "findDoc"
  | "docImage"
  | "docFile"
  | "react"
  | "setPrefs"
  | "setMute"
  | "searchOlder"
  | "olderAround"
  | "fetchOlder"
  | "earlier"
  | "earlierTo"
  | "holdEarlier"
  | "windowControl"
  | "saveTheme"
  | "deleteTheme"
  | "myUsage"
>

export const laterActions: Pick<Actions, LaterName> = {
  docVersions: async (code, th) => (await rare()).versionsOf(link(code), th),
  restoreDocVersion: async (code, ...a) => (await rare()).restoreOf(link(code), ...a),
  putDocImage: async (code, upload) => {
    if (!(await appCan("putImage"))) throw new Error(t("live.actions.update.for.media"))
    const stored = await link(code).putImage(upload)
    if (!stored.ref) throw new Error(t("live.actions.not.stored", { name: upload.name }))
    return { name: stored.name, mime: stored.mime, ref: stored.ref }
  },
  putDocFile: async (code, upload) => {
    if (!(await appCan("putFileData"))) throw new Error(t("live.actions.update.for.media"))
    return link(code).putFileData(upload.name, upload.mime, upload.data)
  },
  leaveRoom: (code, room) =>
    attempt(t("live.actions.leave.room.failed"), async () => {
      await (await manage()).leaveRoom(code, room)
      announce(t("live.actions.left.room"))
    }),
  editMessage: (code, seq, text) => attempt(t("live.actions.not.edited"), async () => (await rare()).change(code, seq, text)),
  deleteMessage: (code, seq) => attempt(t("live.actions.not.deleted"), async () => (await rare()).change(code, seq, null)),
  answerPermission: (code, id, allow) => attempt(t("live.actions.not.answered"), async () => (await rare()).answerPermission(code, id, allow)),
  answerQuestion: (code, id, text) =>
    attempt(t("live.actions.not.answered"), async () => {
      const run = need(code)
      const m = run.messages.find((x) => x.seq === Number(id))
      if (!m) throw new Error(t("live.actions.question.gone"))
      await run.send(text, { to: [m.from], re: [m.seq], kind: "msg", side: true })
    }),
  answerStep: (code, id, reply) => attempt(t("live.actions.not.answered"), async () => (await rare()).answerStep(code, id, reply)),
  answerJoin: (code, id, yes, choice) => attempt(t(yes ? "live.actions.let.in.failed" : "live.actions.turn.away.failed"), async () => (await manage()).answerJoin(code, id, yes, choice)),
  endStep: (code, id, step) => attempt(t("live.actions.step.not.ended"), async () => (await rare()).endStep(code, id, step)),
  approveTask: (code, id, approve, why) => attempt(t(approve ? "live.actions.not.approved" : "live.actions.not.sent.back"), async () => (await rare()).approveTask(code, id, approve, why)),
  addTask: (code, ask, title) =>
    attempt(t("live.actions.task.not.added"), async () => {
      const run = need(code)
      const clean = title.trim().slice(0, TASK_TITLE_MAX_LENGTH)
      if (!clean) throw new Error(t("live.run.task.needs.title"))
      const why = taskSpecRefusal(run.state, { re: ask })
      if (why) throw new Error(why)
      await run.send(`task: ${clean}`, { kind: "event", ev: { op: "task.add", title: clean }, re: [ask] })
    }),
  setSpecsOnly: (code, on) => attempt(t("live.actions.not.changed"), async () => (await manage()).setSpecsOnly(code, on)),
  setTaskStatus: (code, id, status) => attempt(t("live.actions.status.not.changed"), async () => (await rare()).setTaskStatus(code, id, status)),
  cancelTask: (code, id, why) => attempt(t("live.actions.not.cancelled"), async () => (await rare()).cancelTask(code, id, why)),
  closeTask: (code, id, why) => attempt(t("live.actions.not.closed"), async () => (await rare()).closeTask(code, id, why)),
  editTask: (code, id, change) => attempt(t("live.actions.not.saved"), async () => (await rare()).editTask(code, id, change)),
  deleteTask: (code, id) => attempt(t("live.actions.not.deleted"), async () => (await rare()).deleteTask(code, id)),
  assignTask: (code, id, to, why) =>
    attempt(t("live.actions.not.assigned"), async () => {
      const run = need(code)
      const task = run.state.tasks.get(id)
      if (!task) throw new Error(t("live.run.no.task", { id: taskId(id) }))
      memberOf(run, to)
      await sends(run, assignTask(task, to, why.trim() || (task.owner ? `was ${task.owner}'s` : "nobody had it")))
    }),
  setReviewer: (code, id, reviewer) => attempt(t("live.actions.reviewer.not.changed"), async () => (await rare()).setReviewer(code, id, reviewer)),
  nameGoal: (code, ask, name) => attempt(t("live.actions.goal.not.named"), async () => (await rare()).nameGoal(code, ask, name)),
  newSpec: async (code, words, text) => (await rare()).newSpec(code, words, text),
  writeSpec: (code, ask, text) => attempt(t("live.actions.spec.not.saved"), async () => (await rare()).writeSpec(code, ask, text)),
  approveSpec: (code, ask, v) => attempt(t("live.actions.not.approved"), async () => (await rare()).approveSpec(code, ask, v)),
  judgeSpec: (code, ask, verdict, note) =>
    attempt(t(verdict === "accepted" ? "live.actions.not.accepted" : verdict === "back" ? "live.actions.not.sent.back" : "live.actions.not.dropped"), async () =>
      (await rare()).judgeSpec(code, ask, verdict, note)
    ),
  deleteSpec: (code, ask) => attempt(t("live.actions.not.deleted"), async () => (await rare()).deleteSpec(code, ask)),
  setRole: (code, name, role) => attempt(t("live.actions.role.not.changed"), async () => (await manage()).setRole(code, name, role)),
  removeMember: (code, name) => attempt(t("live.actions.remove.member.failed", { name }), async () => (await manage()).removeMember(code, name)),
  setPersona: (code, name, id) => attempt(t("live.actions.personality.not.changed"), async () => (await manage()).setPersona(code, name, id)),
  setReadOnly: (code, name, on) => attempt(t("live.actions.not.changed"), async () => (await manage()).setReadOnly(code, name, on)),
  setWake: (code, name, on) => attempt(t("live.actions.not.changed"), () => setWake(need(code).roomId, name, on)),
  setAgentColor: (code, name, color) => attempt(t("live.actions.colour.not.changed"), async () => (await manage()).setAgentColor(code, name, color)),
  setNickname: (code, name, nickname) => attempt(t("live.actions.nickname.not.changed"), async () => (await manage()).setNickname(code, name, nickname)),
  setPowers: (code, name, powers) => attempt(t("live.actions.not.changed"), async () => (await manage()).setPowers(code, name, powers)),
  addRoom: async (code, typed, members) => (await manage()).addRoom(code, typed, members),
  setRoomMembers: async (code, id, members) =>
    (await tried(t("live.actions.room.members.not.changed"), async () => {
      await (await manage()).setRoomMembers(code, id, members)
      return true
    })) ?? false,
  setGithubWrite: (code, on) => attempt(t("live.actions.not.changed"), async () => (await manage()).setGithubWrite(code, on)),
  setBranchPrefix: (code, typed) => attempt(t("live.actions.branch.prefix.not.changed"), async () => (await manage()).setBranchPrefix(code, typed)),
  setQuiet: (code, typed) => attempt(t("live.actions.quiet.not.changed"), async () => (await manage()).setQuiet(code, typed)),
  setReviewReset: (code, on) => attempt(t("live.actions.not.changed"), async () => (await manage()).setReviewReset(code, on)),
  setResetWaived: (code, name, waived) => attempt(t("live.actions.not.changed"), async () => (await manage()).setResetWaived(code, name, waived)),
  setLanding: (code, then) => attempt(t("live.actions.landing.not.changed"), async () => (await manage()).setLanding(code, then)),
  renameRoom: (code, id, typed) => attempt(t("live.actions.room.not.renamed"), async () => (await manage()).renameRoom(code, id, typed)),
  setIcon: (code, file) =>
    attempt(t("live.actions.icon.not.changed"), async () => {
      const run = owner(code)
      await run.ch.setIcon(file ? await (await import("~/live/icon-file")).iconFromFile(file) : null)
    }),
  exportHistory: async (code, kind) => (await manage()).exportHistory(code, kind),
  clearFact: (code, key) =>
    attempt(t("live.actions.note.not.cleared"), async () => {
      await event(need(code), `cleared ${key}`, { op: "fact.del", key })
      announce(t("live.actions.cleared", { key }))
    }),
  renameChannel: (code, title) =>
    attempt(t("live.actions.not.renamed"), async () => {
      const name = title.trim().slice(0, 80)
      if (!name) throw new Error(t("live.actions.channel.needs.name"))
      await link(code).setTitle(name)
      if (loadMember(code)) await renameChannel(code, name)
    }),
  setGoal: (code, goal) => attempt(t("live.actions.goal.not.set"), async () => (await manage()).setGoal(code, goal)),
  setHold: (code, on, note) => attempt(t(on ? "live.actions.not.paused" : "live.actions.not.resumed"), async () => (await manage()).setHold(code, on, note)),
  askCompact: (code) => attempt(t("live.actions.not.asked"), async () => (await rare()).askCompact(code)),
  approveCompact: async (code, proposal) => (await rare()).approveCompact(code, proposal),
  myRepos: async () => {
    const b = bridge()
    return b ? (await b.githubRepos()).map((r) => r.fullName) : []
  },
  addRepo: (code, repo) => attempt(t("live.actions.repo.not.added"), async () => (await manage()).addRepo(code, repo)),
  removeRepo: (code, repo) => attempt(t("live.actions.repo.not.removed"), async () => (await manage()).removeRepo(code, repo)),
  joinCommand: async (code, as) => (await manage()).joinCommand(code, as),
  inviteLink: async (code) => {
    if (!loadMember(code)) throw new Error(t("live.run.not.in.channel"))
    return `${relayUrl()}/#${code}`
  },
  leaveChannel: (code) =>
    attempt(t("live.actions.leave.failed"), async () => {
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
    attempt(t("live.actions.delete.failed"), async () => {
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
    attempt(t("live.actions.name.not.saved"), async () => {
      if (secrets().person) throw new Error(t("live.actions.name.stays"))
      await createPerson(name.trim())
    }),
  forgetComputer: (id) => void manage().then((m) => m.forgetComputer(id)),
  linkGithub: () => attempt(t("live.actions.github.not.linked"), async () => (await account()).linkGithub()),
  signInWithGithub: () => attempt(t("live.actions.github.not.signed.in"), async () => (await account()).linkGithub()),
  cancelGithubSignIn: () => attempt(t("live.actions.github.not.signed.in"), async () => (await account()).dropGithubCode()),
  unlinkGithub: () => attempt(t("live.actions.github.not.unlinked"), async () => (await account()).unlinkGithub()),
  checkUpdate: async () => (await rare()).checkUpdate(),
  setRelay: async (url) => (await account()).setRelay(url),
  installUpdate: () => attempt(t("live.actions.update.failed"), async () => (await account()).installUpdate()),
  applyUi: () => attempt(t("live.actions.new.look.failed"), async () => (await account()).applyUi()),
  dismissMoved: () => attempt(t("live.actions.note.away.failed"), async () => (await account()).dismissMoved()),
  signOut: () => attempt(t("live.actions.sign.out.failed"), async () => (await account()).signOut()),
  setNewMembers: (code, can) =>
    attempt(t("live.actions.not.changed"), async () => {
      const m = loadMember(code)
      if (!m) throw new Error(t("live.run.not.in.channel"))
      setNewMemberScopes(m.access.roomId, can)
    }),
  setNewPowers: (code, powers) =>
    attempt(t("live.actions.not.changed"), async () => {
      const m = loadMember(code)
      if (!m) throw new Error(t("live.run.not.in.channel"))
      setNewMemberPowers(m.access.roomId, powers)
    }),
  enrollAnswer: (id) => attempt(t("live.actions.device.answer.failed"), async () => (await account()).enrollAnswer(id)),
  enrollConfirm: async (id, digits) => (await account()).enrollConfirm(id, digits),
  enrollDeny: (id) => attempt(t("live.actions.device.deny.failed"), async () => (await account()).enrollDeny(id)),
  forgetDevice: (ids, keep) => attempt(t("live.actions.device.forget.failed"), async () => (await account()).forgetDevice(ids, keep)),
  renewDevice: (...ids) => attempt(t("live.actions.device.renew.failed"), async () => (await account()).renewDevice(...ids)),
  enrollBegin: () =>
    attempt(t("live.actions.enroll.failed"), async () =>
      (await account()).enrollBegin(
        async () => (await auth()).tokenForCreate(),
        (d) => attempt(t("live.actions.join.channels.failed"), async () => (await joining()).joinGranted(d))
      )
    ),
  enrollKeep: () => attempt(t("live.actions.enroll.keep.failed"), async () => (await account()).enrollKeep()),
  enrollCancel: () => attempt(t("live.actions.enroll.cancel.failed"), async () => (await account()).enrollCancel()),
  savePersonalities: (list) => attempt(t("live.actions.not.saved"), () => savePersonalities(list)),
  setHooks,
  checkComputer,
  computerSettings,
  launchedFrom: async (ids) => (await account()).launchedFrom(ids),
  setContextLine: (on) => attempt(t("live.actions.change.failed"), () => setContextLine(on)),
}
