import type { TaskStatus } from "~/model"

export const TONES: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", landing: "tone-review", done: "tone-live", waiting: "tone-decide" }
