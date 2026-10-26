import type { ReactNode } from "react"

import { later } from "@/lib/later"
import type { MessageRefs } from "./markdown"

const markdown = later(
  () => import("./markdown").then((m) => m.Markdown),
  ({ children }: { children: string; refs?: MessageRefs }) => <div className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">{children}</div>
)
const addAgent = later(() => import("./add-agent").then((m) => m.AddAgent))
const newAgent = later(() => import("./new-agent").then((m) => m.NewAgent))
const welcome = later(() => import("./welcome").then((m) => m.Welcome))
const joinScreens = later(() => import("./join-screens").then((m) => m.JoinScreens))
const newChannel = later(() => import("./welcome").then((m) => m.NewChannel))
const joinWithCode = later(() => import("./welcome").then((m) => m.JoinWithCode))
const settings = later(() => import("./settings").then((m) => m.SettingsPage))
const computers = later(() => import("./computers").then((m) => m.ComputersModal))
const palette = later(() => import("./ui/palette").then((m) => m.Palette))
const accountItems = later(() => import("./account-menu").then((m) => m.AccountItems))
const updateParts = () => import("./update-button")
const glyphs = () => import("./message-actions")
const replyGlyph = later(
  () => glyphs().then((m) => m.ReplyGlyph),
  () => <span className="block size-[15px]" />
)
const copyGlyph = later(
  () => glyphs().then((m) => m.CopyGlyph),
  () => <span className="block size-3.5" />
)
const updatePill = later(() => updateParts().then((m) => m.UpdatePill))
const updateButton = later(() => updateParts().then((m) => m.UpdateButton))
const info = later(() => import("./info-panel").then((m) => m.InfoPanel))
const tasks = later(() => import("./tasks-panel").then((m) => m.TasksPanel))
const taskDetails = later(() => import("./task-details").then((m) => m.TaskDetails))
const nowCard = later(() => import("./now-card").then((m) => m.NowCard))
const tasksView = later(() => import("./tasks-view").then((m) => m.TasksView))
const thread = later(() => import("./thread").then((m) => m.ThreadPanel))
const annotator = later(() => import("./annotator").then((m) => m.Annotator))
const presence = later(
  () => import("./side-presence").then((m) => m.SidePresence),
  ({ children }: { children: ReactNode }) => children
)
const agentLanes = later(() => import("./agent-lanes").then((m) => m.AgentLanes))
const composerQuestion = later(() => import("./composer-question").then((m) => m.ComposerQuestion))
const permissionItem = later(() => import("./permission-item").then((m) => m.PermissionItem))
const permissionInThread = later(() => import("./permission-thread").then((m) => m.PermissionInThread))
const commandList = later(() => import("./composer-commands").then((m) => m.CommandList))
const commandBar = later(() => import("./composer-commands").then((m) => m.CommandBar))
const compactBlock = later(() => import("./compact").then((m) => m.CompactBlock))
const proposalCard = later(() => import("./compact").then((m) => m.ProposalCard))
const confirmDialogs = later(() => import("./controls/confirm-dialogs").then((m) => m.ConfirmDialogs))
const invite = later(() => import("./controls/invite").then((m) => m.Invite))
const secrets = later(() => import("./controls/secrets").then((m) => m.Secrets))
const holdDialog = later(() => import("./controls/hold-dialog").then((m) => m.HoldDialog))
const charterDialog = later(() => import("./controls/channel-dialogs").then((m) => m.CharterDialog))
const renameDialog = later(() => import("./controls/channel-dialogs").then((m) => m.RenameDialog))
const branchPrefixDialog = later(() => import("./controls/channel-dialogs").then((m) => m.BranchPrefixDialog))
const activityRun = later(
  () => import("./activity").then((m) => m.ActivityRun),
  () => (
    <p aria-hidden className="my-1 py-[3px] text-meta">
      {"\u00a0"}
    </p>
  )
)

export const Markdown = markdown.View
export const ActivityRun = activityRun.View
export const AddAgent = addAgent.View
export const NewAgent = newAgent.View
export const Welcome = welcome.View
export const JoinScreens = joinScreens.View
export const NewChannel = newChannel.View
export const JoinWithCode = joinWithCode.View
export const SettingsPage = settings.View
export const ComputersModal = computers.View
export const Palette = palette.View
export const AccountItems = accountItems.View
export const preloadAccountItems = accountItems.load
export const UpdatePill = updatePill.View
export const UpdateButton = updateButton.View
export const ReplyGlyph = replyGlyph.View
export const CopyGlyph = copyGlyph.View
export const InfoPanel = info.View
export const TasksPanel = tasks.View
export const TaskDetails = taskDetails.View
export const NowCard = nowCard.View
export const TasksView = tasksView.View
export const ThreadPanel = thread.View
export const Annotator = annotator.View
export const AgentLanes = agentLanes.View
export const Presence = presence.View
export const ComposerQuestion = composerQuestion.View
export const PermissionItem = permissionItem.View
export const PermissionInThread = permissionInThread.View
export const CommandList = commandList.View
export const CommandBar = commandBar.View
export const CompactBlock = compactBlock.View
export const ProposalCard = proposalCard.View
export const ConfirmDialogs = confirmDialogs.View
export const Invite = invite.View
export const Secrets = secrets.View
export const HoldDialog = holdDialog.View
export const CharterDialog = charterDialog.View
export const RenameDialog = renameDialog.View
export const BranchPrefixDialog = branchPrefixDialog.View

export const loadMarkdown = markdown.load

export function loadPermission(): void {
  permissionItem.load()
  permissionInThread.load()
}

export function loadSurfaces(): void {
  for (const surface of [presence, settings, computers, palette, info, tasks, tasksView, taskDetails, thread, confirmDialogs, holdDialog, charterDialog, renameDialog]) surface.load()
}
