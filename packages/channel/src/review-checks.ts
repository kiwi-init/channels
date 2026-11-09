import type { ChannelState } from "@kiwi/core/state.ts";
import { shaKey } from "@kiwi/core/state/github.ts";
import { reviewCheckOf } from "@kiwi/core/protocol.ts";
import { reviewPosts, type ReviewPost } from "@kiwi/core/ship-gate.ts";
import { landingsDue } from "@kiwi/core/done-gate.ts";
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

const landed = new Set<string>();

export const landsToPost = (roomId: string, state: ChannelState) => landingsDue(state).filter((l) => !landed.has(`${roomId}:${l.key}`));

export const landPosted = (roomId: string, key: string): void => {
  landed.add(`${roomId}:${key}`);
};

const sent = new Map<string, { verdict: ReviewPost["verdict"]; seen: string }>();

const seenAt = (roomId: string, state: ChannelState, p: ReviewPost): string => {
  const c = state.github.checks.get(shaKey(p.repo, p.sha))?.get(reviewCheckOf(roomId));
  return c ? `${c.run ?? ""}:${c.status ?? ""}:${c.conclusion ?? ""}` : "";
};

const sentKey = (roomId: string, p: ReviewPost) => `${roomId}:${shaKey(p.repo, p.sha)}`;

export const checksToPost = (roomId: string, state: ChannelState): ReviewPost[] =>
  reviewPosts(state, reviewCheckOf(roomId)).filter((p) => {
    const was = sent.get(sentKey(roomId, p));
    return !was || was.verdict !== p.verdict || was.seen !== seenAt(roomId, state, p);
  });

export const checkPosted = (roomId: string, state: ChannelState, p: ReviewPost): void => void sent.set(sentKey(roomId, p), { verdict: p.verdict, seen: seenAt(roomId, state, p) });
