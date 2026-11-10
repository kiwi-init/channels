import type { ChannelLink } from "./channel-ops.ts";
import { drain } from "./github-queue.ts";
import { headRetired, headsToRetire, issuesToPost, linksToPost, setCheckedUpTo, stepPosted, stepsToPost, tasksToClose } from "./review-checks.ts";
import { closeFromGithub, type TaskSend } from "./task-actions.ts";
import { artifactWords, type StepObservation } from "@kiwi/core/state/landing-steps.ts";
import { landerOf, taskId, type ChannelState } from "@kiwi/core/state.ts";

export function seeStep(o: StepObservation): TaskSend {
  const to = [...new Set([landerOf(o.task), o.task.owner, o.step.by].filter((n): n is string => !!n))];
  return {
    body: `${taskId(o.task.id)} step ${o.step.id} seen done: ${artifactWords(o.artifact)}`,
    opts: { kind: "event", ev: { op: "task.landed", task: o.task.id, step: o.step.id, artifact: o.artifact }, ...(to.length ? { to } : {}) },
  };
}

export async function postReviewChores(ch: ChannelLink, state: ChannelState): Promise<void> {
  const heads = headsToRetire(ch.roomId, state).map((h, seq) => ({ ...h, seq }));
  const links = linksToPost(ch.roomId, state);
  const issues = issuesToPost(ch.roomId, state);
  const closes = tasksToClose(ch.roomId, state);
  const seen = stepsToPost(ch.roomId, state).map((o, seq) => ({ ...o, seq }));
  const answered = new Set<number>();
  if (!heads.length && !links.length && !issues.length && !closes.length && !seen.length) return;
  if (
    !(await drain(
      heads,
      async ({ repo, sha, seq }) => {
        await ch.retireReview({ repo, sha });
        answered.add(seq);
      },
      (seq) => {
        const head = heads[seq];
        if (head && answered.has(seq)) headRetired(ch.roomId, head);
      },
    ))
  )
    return;
  if (
    !(await drain(
      links,
      (l) => ch.commentOnPr(l.repo, l.number, l.body),
      (seq) => setCheckedUpTo(ch.roomId, seq, "prLinks"),
    ))
  )
    return;
  if (
    !(await drain(
      issues,
      (i) => ch.closeIssue(i),
      (seq) => setCheckedUpTo(ch.roomId, seq, "issueCloses"),
    ))
  )
    return;
  if (
    !(await drain(
      closes,
      async (c) => {
        const t = state.tasks.get(c.task);
        if (!t) return;
        const { body, opts } = closeFromGithub(t, c);
        await ch.send(body, opts);
      },
      (seq) => setCheckedUpTo(ch.roomId, seq, "issueTasks"),
    ))
  )
    return;
  await drain(
    seen,
    async (o) => {
      const { body, opts } = seeStep(o);
      await ch.send(body, opts);
    },
    (seq) => {
      const o = seen[seq];
      if (o) stepPosted(ch.roomId, o.key);
    },
  );
}
