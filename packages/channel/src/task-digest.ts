import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState, Task } from "@kiwi/core/state.ts";
import { taskDigest } from "@kiwi/core/work.ts";
import type { TaskSend } from "./task-actions.ts";

export function closedDigest(state: ChannelState, messages: Message[], t: Task, how: { by: string; cancelled?: string }): TaskSend {
  const closed: Task = how.cancelled
    ? { ...t, state: "done", cancelled: true, notes: [...t.notes, { seq: 0, by: how.by, ts: 0, text: how.cancelled }] }
    : { ...t, state: "done", ...(t.review ? { approvedBy: how.by } : {}) };
  return { body: taskDigest(state, messages, closed), opts: { kind: "done", task: t.id } };
}
