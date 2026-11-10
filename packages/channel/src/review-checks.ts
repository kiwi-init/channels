import type { ChannelState } from "@kiwi/core/state.ts";
import { shaKey } from "@kiwi/core/state/github.ts";
import { reviewCheckOf } from "@kiwi/core/protocol.ts";
import { retiredHeads, type RetiredHead } from "@kiwi/core/review-check.ts";
import { prOfTask } from "@kiwi/core/prs.ts";
import { stepObservations, type StepObservation } from "@kiwi/core/state/landing-steps.ts";
import { issuesToClose, issuesToLink, prsToLinkBack, tasksClosedOnGithub } from "@kiwi/core/work.ts";

const memory = new Map<string, number>();
type Mark = "prLinks" | "issueCloses" | "issueTasks";
const keyOf = (mark: Mark, roomId: string) => `kiwi.${mark}.${roomId}`;

export function checkedUpTo(roomId: string, mark: Mark): number | null {
  try {
    const v = localStorage.getItem(keyOf(mark, roomId));
    return v === null ? null : Number(v);
  } catch {
    // Storage refused (private browsing): remember for this load only.
    return memory.get(keyOf(mark, roomId)) ?? null;
  }
}

export function setCheckedUpTo(roomId: string, seq: number, mark: Mark): void {
  memory.set(keyOf(mark, roomId), seq);
  try {
    localStorage.setItem(keyOf(mark, roomId), String(seq));
  } catch {
    // Storage refused: the in-memory mark above still keeps this load from posting twice.
  }
}

function dueAfter<T>(roomId: string, state: ChannelState, mark: Mark, pick: (state: ChannelState, after: number) => T[]): T[] {
  const after = checkedUpTo(roomId, mark);
  if (after === null) {
    setCheckedUpTo(roomId, state.head, mark);
    return [];
  }
  return pick(state, after);
}

export const linksToPost = (roomId: string, state: ChannelState) =>
  dueAfter(roomId, state, "prLinks", (s, after) => [...prsToLinkBack(s, after), ...issuesToLink(s, after)].sort((a, b) => a.seq - b.seq));

export const issuesToPost = (roomId: string, state: ChannelState) => dueAfter(roomId, state, "issueCloses", issuesToClose);

export const tasksToClose = (roomId: string, state: ChannelState) => dueAfter(roomId, state, "issueTasks", tasksClosedOnGithub);

const seen = new Set<string>();

export const stepsToPost = (roomId: string, state: ChannelState): StepObservation[] =>
  stepObservations({ github: state.github, tasks: state.tasks, prOf: (t) => prOfTask(state.github, state.branchPrefix, t) }).filter((o) => !seen.has(`${roomId}:${o.key}`));

export const stepPosted = (roomId: string, key: string): void => {
  seen.add(`${roomId}:${key}`);
};

const retired = new Set<string>();

const retiredKey = (roomId: string, head: RetiredHead) => `${roomId}:${shaKey(head.repo, head.sha)}`;

export const headsToRetire = (roomId: string, state: ChannelState): RetiredHead[] => retiredHeads(state, reviewCheckOf(roomId)).filter((h) => !retired.has(retiredKey(roomId, h)));

export const headRetired = (roomId: string, head: RetiredHead): void => {
  retired.add(retiredKey(roomId, head));
};
