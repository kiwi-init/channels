import type { Channel, Task } from "~/model"

export const openTasks = (channel: Channel): Task[] => channel.tasks.filter((t) => t.status !== "done" && !t.archived)
