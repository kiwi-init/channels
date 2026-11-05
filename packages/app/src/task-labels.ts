import type { TaskState } from "@kiwi/core/protocol.ts";

export const STATE_LABEL: Record<TaskState, string> = { todo: "Up next", doing: "In progress", review: "In review", done: "Done" };

export const DONE_RECENTLY = "Done this week";

export const DECISION = "Needs you";

export const YOUR_REVIEW = "Ready for your review";
