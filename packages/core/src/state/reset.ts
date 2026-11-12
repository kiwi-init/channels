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
  ev: { claim?: true; review?: string | null; judging: boolean },
  from: string,
  review: string | undefined,
  state: string | undefined,
): string | null {
  const id = taskId(task.id);
  const giver = ev.claim || ev.judging ? needsReset(members, from) : undefined;
  if (giver && ev.claim) return `${since(from, giver)}: it takes ${id}'s review from a new session`;
  if (giver) return `${since(from, giver)}: it gives ${id}'s verdict from a new session, or the lead moves the review`;
  const moved = ev.review?.trim();
  const named = moved && moved !== "*" ? needsReset(members, moved) : undefined;
  if (moved && named) return `${since(moved, named)}: ${id}'s review goes to someone else until it rejoins from a new session`;
  const reviewer = state === "review" && review && review !== "*" ? needsReset(members, review) : undefined;
  if (review && reviewer) return `${since(review, reviewer)}: ${id} opens no round for it until it rejoins from a new session`;
  return null;
}

export function addResetRefusal(members: ReadonlyMap<string, Pick<Member, "reset">>, review: string | undefined): string | null {
  const named = review?.trim();
  const mark = named && named !== "*" ? needsReset(members, named) : undefined;
  return named && mark ? `${since(named, mark)}: a new task's review goes to someone else until it rejoins from a new session` : null;
}

export function markReset(on: boolean, giver: Pick<Member, "reset" | "card">, verdict: number): void {
  const session = giver.card?.session;
  if (!on || giver.reset?.kind === "waived" || !sessionPrint(session)) return;
  giver.reset = { kind: "needs", verdict, session };
}

export function sharedWith(members: ReadonlyMap<string, Pick<Member, "card" | "active">>, name: string): string[] {
  const session = members.get(name)?.card?.session;
  return sessionPrint(session) ? [...members.entries()].flatMap(([other, m]) => (other !== name && m.active && m.card?.session === session ? [other] : [])) : [];
}

export function resetLine(state: { reviewReset: boolean; members: ReadonlyMap<string, Pick<Member, "card" | "active" | "reset">> }, name: string): string {
  const mark = state.members.get(name)?.reset;
  const shares = sharedWith(state.members, name);
  return [
    mark?.kind === "needs" ? `needs a fresh session since verdict #${mark.verdict}: reviews nothing until it rejoins from a new session` : "",
    mark?.kind === "waived" && state.reviewReset ? "may review from one session (waived)" : "",
    shares.length ? `shares a session with ${shares.map((x) => `@${x}`).join(", ")}: resetting it resets them too` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function clearOnCard(member: Pick<Member, "reset">, session: unknown): void {
  if (member.reset?.kind === "needs" && sessionPrint(session) && session !== member.reset.session) member.reset = undefined;
}
