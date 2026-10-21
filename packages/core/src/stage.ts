import { inlineText } from "./membership.ts";
import { FAILED, prLinks, taskPr } from "./prs.ts";
import { openRound, prChecks, prKey, type ChannelState, type GithubPr, type Task } from "./state.ts";

type Stage = "open" | "building" | "proving" | "red" | "yours" | "done" | "dropped";

export interface TaskStage {
  stage: Stage;
  declared?: true;
  pr?: GithubPr;
  waitingOn?: string;
}

function linkedPr(state: ChannelState, t: Task): GithubPr | undefined {
  const byBranch = taskPr(state, t.id)?.pr;
  if (byBranch) return byBranch;
  for (const p of [...(t.proof ?? [])].reverse())
    for (const l of prLinks(p.url)) {
      const pr = state.github.prs.get(prKey(l.repo, l.number));
      if (pr) return pr;
    }
  return undefined;
}

const failedAt = (state: ChannelState, pr: GithubPr): string[] => prChecks(state.github, pr).flatMap((r) => (r.conclusion && FAILED.has(r.conclusion) ? [r.name] : []));

export function stageOf(state: ChannelState, t: Task): TaskStage {
  const pr = linkedPr(state, t);
  const withPr = pr ? { pr } : {};
  if (t.state === "done" && t.cancelled) return { stage: "dropped", ...withPr };
  if (pr?.state === "merged" && !failedAt(state, pr).length) return { stage: "done", pr };
  if (t.state === "done") return { stage: "done", declared: true, ...withPr };
  if (pr?.state === "open" && failedAt(state, pr).length) return { stage: "red", pr };
  if (openRound(t)) return { stage: "yours", ...withPr, ...(t.review ? { waitingOn: t.review } : {}) };
  if (pr?.state === "open") return { stage: "proving", pr };
  return { stage: t.owner ? "building" : "open", ...withPr };
}

export function stageText(state: ChannelState, s: TaskStage): string {
  const ref = s.pr ? `#${s.pr.number}` : "";
  const runs = s.pr ? prChecks(state.github, s.pr) : [];
  switch (s.stage) {
    case "dropped":
      return "dropped";
    case "done":
      if (!s.declared) return `done: ${ref} merged`;
      return `done, declared (${!s.pr ? "no merged PR" : s.pr.state === "merged" ? `${ref} merged with a failed check` : `${ref} not merged`})`;
    case "red":
      return `red: ${ref} failed ${s.pr ? failedAt(state, s.pr).join(", ") : ""}`;
    case "yours":
      return `review owed${s.waitingOn ? ` by ${s.waitingOn === "*" ? "anyone who hasn't worked on it" : inlineText(s.waitingOn, 40)}` : ""}${ref ? ` (${ref})` : ""}`;
    case "proving": {
      const running = runs.filter((r) => !r.conclusion).length;
      return `proving: ${ref} ${running ? `${running} check${running === 1 ? "" : "s"} running` : runs.length ? "checks green, not merged" : "no checks yet"}`;
    }
    default:
      return `${s.stage}${ref ? ` (${ref})` : ""}`;
  }
}
