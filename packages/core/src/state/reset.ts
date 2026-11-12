import { sessionPrint } from "../protocol.ts";
import { taskId } from "./tasks.ts";
import type { Member, Task } from "./types.ts";

type Needs = { kind: "needs"; verdict: number; session: string };

export function needsReset(members: ReadonlyMap<string, Pick<Member, "reset">>, name: string | undefined): Needs | undefined {
  const mark = name ? members.get(name)?.reset : undefined;
  return mark?.kind === "needs" ? mark : undefined;
}

const since = (name: string, mark: Needs) => `${name} needs a fresh session since verdict #${mark.verdict}`;

export function resetRefusal(
  members: ReadonlyMap<string, Pick<Member, "reset">>,
  task: Task,
  ev: { claim?: true; review?: string | null; verdict?: string },
  from: string,
  review: string | undefined,
  state: string | undefined,
): string | null {
  const id = taskId(task.id);
  const giver = ev.claim || ev.verdict ? needsReset(members, from) : undefined;
  if (giver && ev.claim) return `${since(from, giver)}: it takes ${id}'s review from a new session`;
  if (giver) return `${since(from, giver)}: it gives ${id}'s verdict from a new session, or the lead moves the review`;
  const moved = ev.review?.trim();
  const named = moved && moved !== "*" ? needsReset(members, moved) : undefined;
  if (moved && named) return `${since(moved, named)}: ${id}'s review goes to someone else until it rejoins from a new session`;
  const reviewer = state === "review" && review && review !== "*" ? needsReset(members, review) : undefined;
  if (review && reviewer) return `${since(review, reviewer)}: ${id} opens no round for it until it rejoins from a new session`;
  return null;
}

export function markReset(on: boolean, giver: Pick<Member, "reset" | "card">, verdict: number): void {
  const session = giver.card?.session;
  if (!on || giver.reset?.kind === "waived" || !sessionPrint(session)) return;
  giver.reset = { kind: "needs", verdict, session };
}

export function clearOnCard(member: Pick<Member, "reset">, session: unknown): void {
  if (member.reset?.kind === "needs" && sessionPrint(session) && session !== member.reset.session) member.reset = undefined;
}
