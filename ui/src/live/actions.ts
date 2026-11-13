import { loadMember } from "@kiwi/channel/store.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { t } from "~/i18n/i18n"
import { announce } from "~/kit/toasts"
import { loadPicture } from "~/live/pictures"
import { deleteTheme, saveTheme, setPrefs } from "~/live/prefs"
import { myUsage } from "~/live/usage"
import { markSeenIn, READ_FLOOR, seenIn } from "@kiwi/app/threads.ts"
import { markSeenTo } from "@kiwi/channel/news.ts"
import { followKey, followMark } from "~/live/threads"
import { lastIn, seenKeyOf } from "~/live/seen-place"
import { openedRun } from "~/live/store"
import { attempt, event, need } from "~/live/run"
import { refusal } from "~/live/refused"
import { appCan } from "~/live/app-can"
import { link } from "~/live/link"
import { findDoc } from "~/chat/doc/find-doc"
import { warmToo } from "~/kit/later"
import type { LaterName } from "~/live/actions-later"
import type { Actions } from "~/model"

type Later = Pick<Actions, LaterName>

const later = (): Promise<Later> => import("~/live/actions-later").then((m) => m.laterActions)
warmToo(later)

const go = (run: (l: Later) => unknown): void => attempt(t("live.actions.change.failed"), async () => run(await later()))

export function makeActions(): Actions {
  return {
    send: async (code, where, text, opts) => {
      const run = openedRun(code)
      if (!run) {
        announce(t("live.actions.not.sent.open"), "error")
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
      attempt(t("live.actions.not.sent"), async () => {
        const run = need(code)
        try {
          await run.retry(-seq)
        } catch {
          // A retry that fails again is marked "Couldn't send" once more.
        }
      }),
    loadImage: (code, spot) => loadPicture(code, spot),
    discard: (code, seq) => attempt(t("live.actions.remove.failed"), async () => need(code).discard(-seq)),
    markRead: (code, where) => {
      const run = need(code)
      const last = lastIn(run.messages, run.state, run.me, where)
      if (last) markSeenIn(run.roomId, { [seenKeyOf(run.state, where, run.me)]: last })
    },
    markChannelRead: (code, head) => {
      const run = openedRun(code)
      const room = run?.roomId ?? loadMember(code)?.access.roomId
      const upTo = Math.max(head ?? 0, run?.messages.at(-1)?.seq ?? 0)
      if (!room || upTo <= 0) return
      markSeenIn(room, { [READ_FLOOR]: upTo })
      markSeenTo(room, upTo)
    },
    openDoc: (code, thread, th, on) => link(code).doc(thread, th, on),
    findDoc: (code, thread) => findDoc(link(code), code, thread),
    docImage: (code, img) => link(code).image(img),
    docFile: async (code, f) => ((await appCan("fileData")) ? link(code).fileData(f) : null),
    followThread: (code, root, on) => {
      const run = need(code)
      markSeenIn(run.roomId, { [followKey(root)]: followMark(seenIn(run.roomId)[followKey(root)], run.messages.at(-1)?.seq ?? 0, on) })
      announce(t(on ? "live.actions.following" : "live.actions.not.following"))
    },
    react: (code, seq, emoji) =>
      attempt(t("live.actions.react.failed"), async () => {
        const run = need(code)
        const mine = run.state.reactions.get(seq)?.get(run.me)?.emoji === emoji
        await event(run, "reaction", { op: "react", seq, emoji: mine ? null : emoji })
      }),
    setPrefs,
    setMute: (code, room, on) => void import("~/live/rare").then((r) => r.setMute(code, room, on)),
    searchOlder: (code, query, before) => import("~/live/older").then((o) => o.searchOlder(code, query, before)),
    olderAround: (code, seq) => import("~/live/older").then((o) => o.olderAround(code, seq)),
    fetchOlder: (code, got) => import("~/live/older").then((o) => o.fetchOlder(code, got)),
    earlier: (code) => (openedRun(code)?.older.more() ?? Promise.resolve(false)).catch(() => false),
    earlierTo: (code, seq) => (openedRun(code)?.older.to(seq) ?? Promise.resolve(false)).catch(() => false),
    holdEarlier: (code, key, seq) => openedRun(code)?.older.keep(key, seq),
    windowControl: (action) =>
      void bridge()
        ?.windowControl(action)
        .catch(() => {}),
    saveTheme,
    deleteTheme,
    myUsage,
    setHooks: async (...a) => (await later()).setHooks(...a),
    checkComputer: async () => (await later()).checkComputer(),
    computerSettings: async (...a) => (await later()).computerSettings(...a),
    docVersions: async (...a) => (await later()).docVersions(...a),
    restoreDocVersion: async (...a) => (await later()).restoreDocVersion(...a),
    putDocImage: async (...a) => (await later()).putDocImage(...a),
    putDocFile: async (...a) => (await later()).putDocFile(...a),
    leaveRoom: (...a) => go((l) => l.leaveRoom(...a)),
    editMessage: (...a) => go((l) => l.editMessage(...a)),
    deleteMessage: (...a) => go((l) => l.deleteMessage(...a)),
    answerPermission: (...a) => go((l) => l.answerPermission(...a)),
    answerQuestion: (...a) => go((l) => l.answerQuestion(...a)),
    answerStep: (...a) => go((l) => l.answerStep(...a)),
    answerJoin: (...a) => go((l) => l.answerJoin(...a)),
    endStep: (...a) => go((l) => l.endStep(...a)),
    approveTask: (...a) => go((l) => l.approveTask(...a)),
    addTask: (...a) => go((l) => l.addTask(...a)),
    setSpecsOnly: (...a) => go((l) => l.setSpecsOnly(...a)),
    setTaskStatus: (...a) => go((l) => l.setTaskStatus(...a)),
    cancelTask: (...a) => go((l) => l.cancelTask(...a)),
    closeTask: (...a) => go((l) => l.closeTask(...a)),
    editTask: (...a) => go((l) => l.editTask(...a)),
    deleteTask: (...a) => go((l) => l.deleteTask(...a)),
    assignTask: (...a) => go((l) => l.assignTask(...a)),
    setReviewer: (...a) => go((l) => l.setReviewer(...a)),
    nameGoal: (...a) => go((l) => l.nameGoal(...a)),
    newSpec: async (...a) => (await later()).newSpec(...a),
    writeSpec: (...a) => go((l) => l.writeSpec(...a)),
    approveSpec: (...a) => go((l) => l.approveSpec(...a)),
    judgeSpec: (...a) => go((l) => l.judgeSpec(...a)),
    deleteSpec: (...a) => go((l) => l.deleteSpec(...a)),
    setRole: (...a) => go((l) => l.setRole(...a)),
    removeMember: (...a) => go((l) => l.removeMember(...a)),
    setPersona: (...a) => go((l) => l.setPersona(...a)),
    setReadOnly: (...a) => go((l) => l.setReadOnly(...a)),
    setWake: (...a) => go((l) => l.setWake(...a)),
    setAgentColor: (...a) => go((l) => l.setAgentColor(...a)),
    setNickname: (...a) => go((l) => l.setNickname(...a)),
    setPowers: (...a) => go((l) => l.setPowers(...a)),
    addRoom: async (...a) => (await later()).addRoom(...a),
    setRoomMembers: async (...a) => (await later()).setRoomMembers(...a),
    setGithubWrite: (...a) => go((l) => l.setGithubWrite(...a)),
    setBranchPrefix: (...a) => go((l) => l.setBranchPrefix(...a)),
    setQuiet: (...a) => go((l) => l.setQuiet(...a)),
    setReviewReset: (...a) => go((l) => l.setReviewReset(...a)),
    setResetWaived: (...a) => go((l) => l.setResetWaived(...a)),
    setLanding: (...a) => go((l) => l.setLanding(...a)),
    renameRoom: (...a) => go((l) => l.renameRoom(...a)),
    setIcon: (...a) => go((l) => l.setIcon(...a)),
    exportHistory: async (...a) => (await later()).exportHistory(...a),
    clearFact: (...a) => go((l) => l.clearFact(...a)),
    renameChannel: (...a) => go((l) => l.renameChannel(...a)),
    setGoal: (...a) => go((l) => l.setGoal(...a)),
    setHold: (...a) => go((l) => l.setHold(...a)),
    askCompact: (...a) => go((l) => l.askCompact(...a)),
    approveCompact: async (...a) => (await later()).approveCompact(...a),
    myRepos: async () => (await later()).myRepos(),
    addRepo: (...a) => go((l) => l.addRepo(...a)),
    removeRepo: (...a) => go((l) => l.removeRepo(...a)),
    joinCommand: async (...a) => (await later()).joinCommand(...a),
    inviteLink: async (...a) => (await later()).inviteLink(...a),
    leaveChannel: (...a) => go((l) => l.leaveChannel(...a)),
    closeChannel: (...a) => go((l) => l.closeChannel(...a)),
    newChannel: async (...a) => (await later()).newChannel(...a),
    inviteInfo: async (...a) => (await later()).inviteInfo(...a),
    joinChannel: async (...a) => (await later()).joinChannel(...a),
    setName: (...a) => go((l) => l.setName(...a)),
    forgetComputer: (...a) => go((l) => l.forgetComputer(...a)),
    linkGithub: () => go((l) => l.linkGithub()),
    signInWithGithub: () => go((l) => l.signInWithGithub()),
    cancelGithubSignIn: () => go((l) => l.cancelGithubSignIn()),
    unlinkGithub: () => go((l) => l.unlinkGithub()),
    checkUpdate: async () => (await later()).checkUpdate(),
    setRelay: async (...a) => (await later()).setRelay(...a),
    installUpdate: () => go((l) => l.installUpdate()),
    applyUi: () => go((l) => l.applyUi()),
    dismissMoved: () => go((l) => l.dismissMoved()),
    signOut: () => go((l) => l.signOut()),
    setNewMembers: (...a) => go((l) => l.setNewMembers(...a)),
    setNewPowers: (...a) => go((l) => l.setNewPowers(...a)),
    enrollAnswer: (...a) => go((l) => l.enrollAnswer(...a)),
    enrollConfirm: async (...a) => (await later()).enrollConfirm(...a),
    enrollDeny: (...a) => go((l) => l.enrollDeny(...a)),
    forgetDevice: (...a) => go((l) => l.forgetDevice(...a)),
    renewDevice: (...a) => go((l) => l.renewDevice(...a)),
    enrollBegin: () => go((l) => l.enrollBegin()),
    enrollKeep: () => go((l) => l.enrollKeep()),
    enrollCancel: () => go((l) => l.enrollCancel()),
    savePersonalities: (...a) => go((l) => l.savePersonalities(...a)),
    launchedFrom: async (...a) => (await later()).launchedFrom(...a),
    setContextLine: (...a) => go((l) => l.setContextLine(...a)),
  }
}
