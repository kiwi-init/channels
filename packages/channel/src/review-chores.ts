import type { ChannelState } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";
import { drain } from "./github-queue.ts";
import { checkPosted, checksToPost, issuesToPost, linksToPost, setCheckedUpTo, tasksToClose } from "./review-checks.ts";
import { closeFromGithub } from "./task-actions.ts";

export async function postReviewChores(ch: ChannelLink, state: ChannelState): Promise<void> {
  const due = checksToPost(ch.roomId, state).map((p, seq) => ({ ...p, seq }));
  const links = linksToPost(ch.roomId, state);
  const issues = issuesToPost(ch.roomId, state);
  const closes = tasksToClose(ch.roomId, state);
  if (!due.length && !links.length && !issues.length && !closes.length) return;
  if (
    !(await drain(
      due,
      ({ repo, sha, verdict, tasks, note }) => ch.postReviewCheck({ repo, sha, verdict, tasks, ...(note ? { note } : {}) }),
      (seq) => {
        const p = due[seq];
        if (p) checkPosted(ch.roomId, state, p);
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
  await drain(
    closes,
    async (c) => {
      const t = state.tasks.get(c.task);
      if (!t) return;
      const { body, opts } = closeFromGithub(t, c);
      await ch.send(body, opts);
    },
    (seq) => setCheckedUpTo(ch.roomId, seq, "issueTasks"),
  );
}
