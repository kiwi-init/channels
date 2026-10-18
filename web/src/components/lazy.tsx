import { later } from "@/lib/later"
import type { MessageRefs } from "./markdown"

const markdown = later(
  () => import("./markdown").then((m) => m.Markdown),
  ({ children }: { children: string; refs?: MessageRefs }) => <div className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">{children}</div>
)
const settings = later(() => import("./settings").then((m) => m.SettingsModal))
const computers = later(() => import("./computers").then((m) => m.ComputersModal))
const palette = later(() => import("./ui/palette").then((m) => m.Palette))
const info = later(() => import("./info-panel").then((m) => m.InfoPanel))
const tasks = later(() => import("./tasks-panel").then((m) => m.TasksPanel))
const taskDetails = later(() => import("./task-details").then((m) => m.TaskDetails))
const taskInline = later(() => import("./task-inline").then((m) => m.TaskInline))
const thread = later(() => import("./thread").then((m) => m.ThreadPanel))
const annotator = later(() => import("./annotator").then((m) => m.Annotator))
const agentLanes = later(() => import("./agent-lanes").then((m) => m.AgentLanes))
const talkButton = later(() => import("./talk").then((m) => m.TalkButton))
const talkBar = later(() => import("./talk").then((m) => m.TalkBar))
const composerQuestion = later(() => import("./composer-question").then((m) => m.ComposerQuestion))
const commandList = later(() => import("./composer-commands").then((m) => m.CommandList))
const commandBar = later(() => import("./composer-commands").then((m) => m.CommandBar))
const repos = later(() => import("./controls/repos-dialog").then((m) => m.ReposDialog))
const compactBlock = later(() => import("./compact").then((m) => m.CompactBlock))
const proposalCard = later(() => import("./compact").then((m) => m.ProposalCard))

export const Markdown = markdown.View
export const SettingsModal = settings.View
export const ComputersModal = computers.View
export const Palette = palette.View
export const InfoPanel = info.View
export const TasksPanel = tasks.View
export const TaskDetails = taskDetails.View
export const TaskInline = taskInline.View
export const ThreadPanel = thread.View
export const Annotator = annotator.View
export const AgentLanes = agentLanes.View
export const TalkButton = talkButton.View
export const TalkBar = talkBar.View
export const ComposerQuestion = composerQuestion.View
export const CommandList = commandList.View
export const CommandBar = commandBar.View
export const ReposDialog = repos.View
export const CompactBlock = compactBlock.View
export const ProposalCard = proposalCard.View

export const loadMarkdown = markdown.load

export function loadSurfaces(): void {
  for (const surface of [settings, computers, palette, info, tasks, taskDetails, taskInline, thread]) surface.load()
}
