import { RelayError } from "@kiwi/core/client/relay-errors.ts";
import type { ChannelLink } from "./channel-ops.ts";
import { drain } from "./github-queue.ts";
import { checkPosted, checksToPost, issuesToPost, landPosted, landsToPost, linksToPost, setCheckedUpTo, stepsToPost, tasksToClose } from "./review-checks.ts";
import { closeFromGithub, type TaskSend } from "./task-actions.ts";
import type { CheckArtifact } from "@kiwi/core/checks.ts";
import { artifactText } from "@kiwi/core/done-gate.ts";
import type { StepObservation } from "@kiwi/core/state/landing-steps.ts";
import { landerOf, taskId, type ChannelState, type Task } from "@kiwi/core/state.ts";

export function landTask(t: Task, artifact: CheckArtifact): TaskSend {
  const to = [...new Set([landerOf(t), t.owner].filter((n): n is string => !!n))];
  return {
    body: `${taskId(t.id)} landed: ${artifactText(artifact)}`,
    opts: { kind: "event", ev: { op: "task.landed", task: t.id, artifact }, ...(to.length ? { to } : {}) },
  };
}

export function seeStep(o: StepObservation): TaskSend {
  const to = [...new Set([landerOf(o.task), o.task.owner, o.step.by].filter((n): n is string => !!n))];
  return {
    body: `${taskId(o.task.id)} step ${o.step.id} seen done: ${artifactText(o.artifact)}`,
    opts: { kind: "event", ev: { op: "task.landed", task: o.task.id, step: o.step.id, artifact: o.artifact }, ...(to.length ? { to } : {}) },
  };
}

export async function postReviewChores(ch: ChannelLink, state: ChannelState): Promise<void> {
  const due = checksToPost(ch.roomId, state).map((p, seq) => ({ ...p, seq }));
  const fenced = new Set<number>();
  const links = linksToPost(ch.roomId, state);
  const issues = issuesToPost(ch.roomId, state);
  const closes = tasksToClose(ch.roomId, state);
  const lands = landsToPost(ch.roomId, state);
  const seen = stepsToPost(ch.roomId, state).map((o, seq) => ({ ...o, seq }));
  if (!due.length && !links.length && !issues.length && !closes.length && !lands.length && !seen.length) return;
  if (
    !(await drain(
      due,
      async ({ repo, sha, verdict, tasks, note, seq }) => {
        try {
          await ch.postReviewCheck({ repo, sha, verdict, tasks, ...(note ? { note } : {}), ...(verdict === "approved" ? { upTo: state.head } : {}) });
        } catch (err) {
          if (!(err instanceof RelayError && err.tag === "Fenced")) throw err;
          // A change at that commit is still on its way, or landed after this state: the next look posts again.
          fenced.add(seq);
        }
      },
      (seq) => {
        const p = due[seq];
        if (p && !fenced.has(seq)) checkPosted(ch.roomId, state, p);
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
  if (
    !(await drain(
      lands,
      async (l) => {
        const { body, opts } = landTask(l.task, l.artifact);
        await ch.send(body, opts);
      },
      (seq) => {
        const l = lands.find((x) => x.seq === seq);
        if (l) landPosted(ch.roomId, l.key);
      },
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
      if (o) landPosted(ch.roomId, o.key);
    },
  );
}
