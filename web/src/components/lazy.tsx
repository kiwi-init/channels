import { later } from "@/lib/later"

const markdown = later(
  () => import("./markdown").then((m) => m.Markdown),
  ({ children }: { children: string }) => <div className="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">{children}</div>
)
const settings = later(() => import("./settings").then((m) => m.SettingsModal))
const computers = later(() => import("./computers").then((m) => m.ComputersModal))
const palette = later(() => import("./ui/palette").then((m) => m.Palette))
const info = later(() => import("./info-panel").then((m) => m.InfoPanel))
const tasks = later(() => import("./tasks-panel").then((m) => m.TasksPanel))
const taskDetails = later(() => import("./task-details").then((m) => m.TaskDetails))
const thread = later(() => import("./thread").then((m) => m.ThreadPanel))
const annotator = later(() => import("./annotator").then((m) => m.Annotator))

export const Markdown = markdown.View
export const SettingsModal = settings.View
export const ComputersModal = computers.View
export const Palette = palette.View
export const InfoPanel = info.View
export const TasksPanel = tasks.View
export const TaskDetails = taskDetails.View
export const ThreadPanel = thread.View
export const Annotator = annotator.View

export const loadMarkdown = markdown.load

export function loadSurfaces(): void {
  for (const surface of [settings, computers, palette, info, tasks, taskDetails, thread]) surface.load()
}
