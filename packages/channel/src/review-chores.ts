import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";
import { drain } from "./github-queue.ts";
import { checksToPost, issuesToPost, linksToPost, setCheckedUpTo, tasksToClose } from "./review-checks.ts";
import { closeFromGithub } from "./task-actions.ts";

export async function postReviewChores(ch: ChannelLink, state: ChannelState, messages: Message[]): Promise<void> {
  const due = checksToPost(ch.roomId, state, messages);
  const links = linksToPost(ch.roomId, state);
  const issues = issuesToPost(ch.roomId, state);
  const closes = tasksToClose(ch.roomId, state);
  if (!due.length && !links.length && !issues.length && !closes.length) return;
  if (
    !(await drain(
      due,
      (c) => ch.postReviewCheck(c),
      (seq) => setCheckedUpTo(ch.roomId, seq),
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
