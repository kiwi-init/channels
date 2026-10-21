import { later } from "@/lib/later"
import type { MessageRefs } from "./markdown"

const markdown = later(
  () => import("./markdown").then((m) => m.Markdown),
  ({ children }: { children: string; refs?: MessageRefs }) => <div className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">{children}</div>
)
const addAgent = later(() => import("./add-agent").then((m) => m.AddAgent))
const newAgent = later(() => import("./new-agent").then((m) => m.NewAgent))
const welcome = later(() => import("./welcome").then((m) => m.Welcome))
const newChannel = later(() => import("./welcome").then((m) => m.NewChannel))
const joinWithCode = later(() => import("./welcome").then((m) => m.JoinWithCode))
const settings = later(() => import("./settings").then((m) => m.SettingsPage))
const computers = later(() => import("./computers").then((m) => m.ComputersModal))
const palette = later(() => import("./ui/palette").then((m) => m.Palette))
const info = later(() => import("./info-panel").then((m) => m.InfoPanel))
const tasks = later(() => import("./tasks-panel").then((m) => m.TasksPanel))
const taskDetails = later(() => import("./task-details").then((m) => m.TaskDetails))
const tasksView = later(() => import("./tasks-view").then((m) => m.TasksView))
const thread = later(() => import("./thread").then((m) => m.ThreadPanel))
const annotator = later(() => import("./annotator").then((m) => m.Annotator))
const agentLanes = later(() => import("./agent-lanes").then((m) => m.AgentLanes))
const talkButton = later(() => import("./talk").then((m) => m.TalkButton))
const talkBar = later(() => import("./talk").then((m) => m.TalkBar))
const composerQuestion = later(() => import("./composer-question").then((m) => m.ComposerQuestion))
const permissionItem = later(() => import("./permission-item").then((m) => m.PermissionItem))
const permissionInThread = later(() => import("./permission-thread").then((m) => m.PermissionInThread))
const commandList = later(() => import("./composer-commands").then((m) => m.CommandList))
const commandBar = later(() => import("./composer-commands").then((m) => m.CommandBar))
const compactBlock = later(() => import("./compact").then((m) => m.CompactBlock))
const proposalCard = later(() => import("./compact").then((m) => m.ProposalCard))
const confirmDialogs = later(() => import("./controls/confirm-dialogs").then((m) => m.ConfirmDialogs))
const invite = later(() => import("./controls/invite").then((m) => m.Invite))
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
export const NewChannel = newChannel.View
export const JoinWithCode = joinWithCode.View
export const SettingsPage = settings.View
export const ComputersModal = computers.View
export const Palette = palette.View
export const InfoPanel = info.View
export const TasksPanel = tasks.View
export const TaskDetails = taskDetails.View
export const TasksView = tasksView.View
export const ThreadPanel = thread.View
export const Annotator = annotator.View
export const AgentLanes = agentLanes.View
export const TalkButton = talkButton.View
export const TalkBar = talkBar.View
export function leaveTalk(roomId: string): void {
  void import("./talk").then((m) => m.leaveTalk(roomId))
}
export const ComposerQuestion = composerQuestion.View
export const PermissionItem = permissionItem.View
export const PermissionInThread = permissionInThread.View
export const CommandList = commandList.View
export const CommandBar = commandBar.View
export const CompactBlock = compactBlock.View
export const ProposalCard = proposalCard.View
export const ConfirmDialogs = confirmDialogs.View
export const Invite = invite.View
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
  for (const surface of [settings, computers, palette, info, tasks, tasksView, taskDetails, thread, confirmDialogs, holdDialog, charterDialog, renameDialog]) surface.load()
}
