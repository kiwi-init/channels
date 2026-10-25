import { inlineText } from "./membership.ts";
import { ignored, type Message } from "./protocol.ts";
import { checksOf, prLinks, rulesText, taskPr } from "./prs.ts";
import { openRound, prKey, rulesOf, type ChannelState, type GithubPr, type ReviewRound, type Task } from "./state.ts";

type Stage = "open" | "building" | "proving" | "red" | "yours" | "done" | "dropped";

export interface TaskStage {
  stage: Stage;
  declared?: true;
  pr?: GithubPr;
  waitingOn?: string;
  judgedAt?: string;
}

type Ref = { kind: "pr"; repo: string; number: number } | { kind: "sha"; repo: string; sha: string } | { kind: "file"; hash: string; name: string } | { kind: "link"; url: string; label?: string };

const SHA_MIN = 7;

const sameHead = (at: string, head: string): boolean => at === head || (at.length >= SHA_MIN && head.length >= SHA_MIN && (head.startsWith(at) || at.startsWith(head)));

const short = (sha: string): string => sha.slice(0, SHA_MIN);

function lastVerdict(t: Task): ReviewRound | undefined {
  return [...t.rounds].reverse().find((r) => r.result.kind === "approved" || r.result.kind === "rejected");
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

const failedAt = (state: ChannelState, pr: GithubPr): string[] => checksOf(state, pr)?.failed ?? [];

export function stageOf(state: ChannelState, t: Task): TaskStage {
  const pr = linkedPr(state, t);
  const withPr = pr ? { pr } : {};
  const head = pr?.state === "open" ? pr.sha : undefined;
  const owed = t.review ? { waitingOn: t.review } : {};
  const verdict = lastVerdict(t);
  const moved = (r: ReviewRound | undefined): r is ReviewRound & { at: string } => !!r?.at && !!head && !sameHead(r.at, head);
  if (t.state === "done" && t.cancelled) return { stage: "dropped", ...withPr };
  if (pr?.state === "merged" && !failedAt(state, pr).length) return { stage: "done", pr };
  if (t.state === "done" && verdict?.result.kind === "approved" && moved(verdict)) return { stage: "yours", ...withPr, ...owed, judgedAt: verdict.at };
  if (t.state === "done") return { stage: "done", declared: true, ...withPr };
  if (pr?.state === "open" && failedAt(state, pr).length) return { stage: "red", pr };
  const round = openRound(t);
  if (round) return { stage: "yours", ...withPr, ...owed, ...(moved(round) ? { judgedAt: round.at } : {}) };
  if (verdict?.result.kind === "rejected" && verdict.at && head && sameHead(verdict.at, head)) return { stage: "building", ...withPr, judgedAt: verdict.at };
  if (pr?.state === "open") return { stage: "proving", pr };
  return { stage: t.owner ? "building" : "open", ...withPr };
}

function checksText(state: ChannelState, pr: GithubPr): string {
  const c = checksOf(state, pr);
  if (!c) return "none yet";
  const parts = [
    c.passed ? `${c.passed} passed` : "",
    c.failed.length ? `${c.failed.length} failed (${c.failed.map((n) => inlineText(n, 60)).join(", ")})` : "",
    c.running ? `${c.running} ${c.waiting ? "waiting" : "running"}${c.waiting ? ` (${c.waiting.map((n) => inlineText(n, 60)).join(", ")})` : ""}` : "",
  ].filter(Boolean);
  return `${parts.join(", ")}${c.required ? `, of the required ${c.required.map((n) => inlineText(n, 60)).join(", ")}` : ", of every check (no merge rules read)"}`;
}

export function prLines(state: ChannelState, pr: GithubPr): string[] {
  const rules = rulesOf(state.github, pr.repo);
  return [
    `  pr: ${pr.repo}#${pr.number} ${pr.state}${pr.branch ? ` from ${inlineText(pr.branch, 120)}` : ""}${pr.url ? ` · ${inlineText(pr.url, 300)}` : ""}`,
    `  checks: ${checksText(state, pr)}`,
    ...(rules ? [`  merge rules (${inlineText(rules.branch, 60)}): ${rulesText(rules)}`] : []),
  ];
}

export function evidenceOf(state: ChannelState, t: Task, messages: readonly Message[] = []): Ref[] {
  const refs: Ref[] = [];
  const seen = new Set<string>();
  const add = (key: string, ref: Ref) => {
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  const pr = linkedPr(state, t);
  if (pr) {
    add(`pr:${prKey(pr.repo, pr.number)}`, { kind: "pr", repo: pr.repo, number: pr.number });
    if (pr.sha) add(`sha:${pr.sha}`, { kind: "sha", repo: pr.repo, sha: pr.sha });
  }
  for (const p of t.proof ?? []) {
    const links = prLinks(p.url);
    for (const l of links) add(`pr:${prKey(l.repo, l.number)}`, { kind: "pr", repo: l.repo, number: l.number });
    if (!links.length) add(`link:${p.url}`, { kind: "link", url: p.url, ...(p.label ? { label: p.label } : {}) });
  }
  for (const m of messages) {
    const place = state.placeOf.get(m.seq);
    if (place?.kind !== "task" || place.task !== t.id || ignored(state.trust.get(m.seq))) continue;
    for (const i of m.imgs ?? []) if (i.ref) add(`file:${i.ref.id}`, { kind: "file", hash: i.ref.id, name: i.name });
  }
  return refs;
}

export function refText(state: ChannelState, r: Ref): string {
  switch (r.kind) {
    case "pr":
      return `PR ${r.repo}#${r.number}${state.github.prs.get(prKey(r.repo, r.number))?.state === "merged" ? " (merged)" : ""}`;
    case "sha":
      return `head ${short(r.sha)}`;
    case "file":
      return `${inlineText(r.name, 80)} (file ${short(r.hash)})`;
    default:
      return `${inlineText(r.url, 200)}${r.label ? ` (${inlineText(r.label, 40)})` : ""}`;
  }
}

export function stageText(state: ChannelState, s: TaskStage): string {
  const ref = s.pr ? `#${s.pr.number}` : "";
  const checks = s.pr ? checksOf(state, s.pr) : undefined;
  switch (s.stage) {
    case "dropped":
      return "dropped";
    case "done":
      if (!s.declared) return `done: ${ref} merged`;
      return `done, declared (${!s.pr ? "no merged PR" : s.pr.state === "merged" ? `${ref} merged with a failed check` : `${ref} not merged`})`;
    case "red":
      return `red: ${ref} failed ${s.pr ? failedAt(state, s.pr).join(", ") : ""}`;
    case "yours": {
      const who = s.waitingOn ? ` by ${s.waitingOn === "*" ? "anyone who hasn't worked on it" : inlineText(s.waitingOn, 40)}` : "";
      const moved = s.judgedAt && s.pr?.sha ? `judged at ${short(s.judgedAt)}, head now ${short(s.pr.sha)}` : "";
      const why = [ref, moved].filter(Boolean).join("; ");
      return `review owed${who}${why ? ` (${why})` : ""}`;
    }
    case "building":
      return s.judgedAt ? `building: changes asked at ${short(s.judgedAt)}${ref ? ` (${ref})` : ""}` : `building${ref ? ` (${ref})` : ""}`;
    case "proving": {
      if (checks?.waiting && checks.required) return `proving: ${ref} ${checks.waiting.length ? `waiting on ${checks.waiting.join(", ")}` : `${checks.required.join(", ")} green, not merged`}`;
      const running = checks?.running ?? 0;
      return `proving: ${ref} ${running ? `${running} check${running === 1 ? "" : "s"} running` : checks ? "checks green, not merged" : "no checks yet"}`;
    }
    default:
      return `${s.stage}${ref ? ` (${ref})` : ""}`;
  }
}
