import { RelayError } from "@kiwi/core/client/relay-errors.ts";
import type { ChannelState } from "@kiwi/core/state.ts";
import type { ChannelLink } from "./channel-ops.ts";
import { drain } from "./github-queue.ts";
import { checkPosted, checksToPost, issuesToPost, linksToPost, setCheckedUpTo, tasksToClose } from "./review-checks.ts";
import { closeFromGithub } from "./task-actions.ts";

export async function postReviewChores(ch: ChannelLink, state: ChannelState): Promise<void> {
  const due = checksToPost(ch.roomId, state).map((p, seq) => ({ ...p, seq }));
  const fenced = new Set<number>();
  const links = linksToPost(ch.roomId, state);
  const issues = issuesToPost(ch.roomId, state);
  const closes = tasksToClose(ch.roomId, state);
  if (!due.length && !links.length && !issues.length && !closes.length) return;
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
