import { stageOf, type TaskStage } from "./stage.ts";
import { releaseOf, tasksAwaitingPeople, type ChannelState, type Task } from "./state.ts";

type Status = "planned" | "working" | "needs you" | "done" | "shipped" | "cancelled";

export interface TaskStatus {
  status: Status;
  release?: string;
  stage: TaskStage;
}

const awaiting = new WeakMap<ChannelState["openAsks"], Set<number>>();

export function needsYou(state: Pick<ChannelState, "openAsks" | "placeOf" | "tasks">, id: number): boolean {
  let held = awaiting.get(state.openAsks);
  if (!held) awaiting.set(state.openAsks, (held = tasksAwaitingPeople(state)));
  return held.has(id);
}

export function statusOf(state: ChannelState, t: Task): TaskStatus {
  const stage = stageOf(state, t);
  if (stage.stage === "dropped") return { status: "cancelled", stage };
  if (stage.stage === "done") {
    const release = stage.pr ? releaseOf(state.github, stage.pr) : undefined;
    return release ? { status: "shipped", release: release.tag, stage } : { status: "done", stage };
  }
  if (needsYou(state, t.id)) return { status: "needs you", stage };
  if (t.state === "doing" || t.state === "review" || t.state === "done" || stage.pr?.state === "open") return { status: "working", stage };
  return { status: "planned", stage };
}

export const versionName = (tag: string): string => tag.replace(/^v(?=\d)/, "");

export const statusWord = (s: Pick<TaskStatus, "status" | "release">): string => (s.status === "shipped" && s.release ? `shipped in ${versionName(s.release)}` : s.status);
